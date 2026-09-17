/**
 * El cerebro de BAKO — B1 del plan (06/09/2026).
 *
 * Hasta ahora todo lo que BAKO aprendía hablando caía en `Memory` como frases
 * sueltas: nunca creaba ni actualizaba una Persona o una entrada de
 * Conocimiento, aunque las tres colecciones existieran. "Ibon se ha mudado a
 * Bilbao" generaba un recuerdo más en vez de tocar la ficha de Ibon.
 *
 * Aquí vive el clasificador que decide EN QUÉ CAJA va cada dato y si crea o
 * actualiza algo que ya existe:
 *   - persona      → `Person`          (gente del entorno de Borja)
 *   - conocimiento → `KnowledgeEntry`  (hechos duraderos sobre el propio Borja)
 *   - recuerdo     → `Memory`          (lo que no encaja en las anteriores)
 *
 * Corre en segundo plano tras cada turno, no como herramienta del LLM: con
 * Ollama por defecto toda llamada a herramienta pasa por el gate de
 * confirmación (qwen3:8b alucina llamadas), y pedir permiso para cada dato que
 * se aprende haría la conversación inusable. Escribir aquí, con validación
 * propia y en background, es más seguro y no interrumpe.
 */

import { Person, IPerson } from '../memory/Person';
import { KnowledgeEntry, KnowledgeCategory } from '../memory/KnowledgeEntry';
import { askClaude } from '../llm/claude';
import { deduplicateAndSave, searchMemories } from './memory';
import { isSensitive } from './privacy';
import { escapeRegex } from '../middleware/security';
import { PROFILE_FIELDS } from './profileDynamic';

const CATEGORIAS: KnowledgeCategory[] = [
  'salud', 'valores', 'caracter', 'finanzas', 'historia', 'rutina', 'objetivos', 'legal', 'hobbies', 'otro',
];
const RELACIONES = ['pareja', 'familiar', 'amigo', 'compañero', 'conocido', 'otro'];

// Se deriva de PROFILE_FIELDS en vez de escribirse a mano en el prompt: la lista
// escrita a mano ya se había desincronizado una vez (excluía "rutina laboral"
// diciendo que vivía en el perfil base, cuando tras el reset de B2 no vivía en
// ningún sitio — así que esa información no se guardaba en ninguna caja).
const CAMPOS_DE_PERFIL = Object.values(PROFILE_FIELDS).map(f => f.label.toLowerCase()).join(', ');

// ─── Qué sabe ya, para que el clasificador pueda decir "actualizar" ──────────

interface Snapshot { personas: string[]; claves: string[] }

async function loQueYaSabe(alaNube: boolean): Promise<Snapshot> {
  const [personas, conocimiento] = await Promise.all([
    Person.find({ activo: true }).select('nombre').lean(),
    KnowledgeEntry.find({ activo: true }).select('categoria clave').lean(),
  ]);

  let claves = conocimiento.map((k: any) => `${k.categoria}/${k.clave}`);
  // El índice del cerebro también es información. Mandar a la nube la lista
  // entera de claves filtraría la EXISTENCIA de asuntos reservados —
  // `legal/proceso_judicial` lo cuenta todo con solo leer su nombre— aunque el
  // turno en curso no los mencione. Al clasificar fuera se recorta.
  if (alaNube) {
    claves = claves.filter(c => !c.startsWith('legal/') && !isSensitive(c));
  }
  return { personas: personas.map((p: any) => p.nombre), claves };
}

// ─── Clasificador ────────────────────────────────────────────────────────────

function promptClasificador(snap: Snapshot): string {
  return `Eres el sistema de memoria de BAKO, el mayordomo digital de Borja. Analiza la conversación y
decide qué merece guardarse y EN QUÉ CAJA. Guardar de menos es preferible a guardar basura.

CAJAS:
- "persona": datos sobre alguien concreto del entorno de Borja (tiene nombre propio). Campos posibles:
  nombre, relacion (${RELACIONES.join('|')}), descripcion, cumpleaños (formato DD-MM), ubicacion,
  trabajo, notas (lista), conexiones (lista de nombres de otras personas).
- "conocimiento": hechos duraderos sobre el PROPIO Borja, con categoria (${CATEGORIAS.join('|')}),
  una clave corta en snake_case y un valor. Elige la categoria que mejor encaje; "otro" solo si de
  verdad no encaja en ninguna (un habito o entrenamiento es "rutina", una meta es "objetivos").
- "recuerdo": lo que no encaje en las dos anteriores — observaciones, estados de ánimo, decisiones
  puntuales, bloqueos en proyectos.

YA EXISTEN estas personas: ${snap.personas.length ? snap.personas.join(', ') : '(ninguna)'}
YA EXISTE este conocimiento (categoria/clave): ${snap.claves.length ? snap.claves.join(', ') : '(ninguno)'}

Si el dato afecta a algo que YA EXISTE, usa "actualizar" e incluye SOLO los campos que cambian.
Si es nuevo, usa "crear".

NO guardes: consultas de tiempo, noticias o la hora; saludos; eventos de calendario con fecha y hora
(el calendario es su propia fuente de verdad); nada que ya conste arriba sin cambios; ni lo que diga
BAKO sobre sí mismo (qué modelo usa, dónde se ejecuta). Tampoco estos campos CUANDO SON DEL PROPIO
BORJA — de las demás personas sí se guardan en su ficha, que para eso está la caja "persona":
${CAMPOS_DE_PERFIL}. Esos ocho tienen su propia ficha de perfil y su propio cauce de actualización
("ya no trabajo en X", "me he mudado a Y", "nací el 12/03/1990"). Ojo: la rutina, los hábitos y los horarios de Borja SÍ son conocimiento y se
guardan en la caja "conocimiento" con categoria "rutina".

Responde ÚNICAMENTE con un array JSON, sin texto alrededor:
[
  {"caja":"persona","accion":"crear|actualizar","nombre":"...","relacion":"...","ubicacion":"...","trabajo":"","descripcion":"","cumpleaños":"","notas":[],"conexiones":[]},
  {"caja":"conocimiento","accion":"crear|actualizar","categoria":"...","clave":"...","valor":"...","detalles":[],"importancia":"alta|media|baja"},
  {"caja":"recuerdo","contenido":"...","tipo":"fact|preference|project_update|decision|feeling","importancia":"high|medium|low","tags":["..."]}
]
Si no hay nada que merezca guardarse, responde exactamente: []`;
}

interface Operacion {
  caja?: string; accion?: string;
  nombre?: string; relacion?: string; descripcion?: string; cumpleaños?: string;
  ubicacion?: string; trabajo?: string; notas?: string[]; conexiones?: string[];
  categoria?: string; clave?: string; valor?: string; detalles?: string[]; importancia?: string;
  contenido?: string; tipo?: string; tags?: string[];
}

/**
 * Texto libre que escribe el clasificador por su cuenta, sin que nadie lo revise.
 * `relacion` y `cumpleaños` ya se validaban (lista blanca y regex); estos campos
 * entraban crudos y el panel los pinta, así que se recortan y se les quitan los
 * ángulos: el escapado del panel es la defensa buena, esto es la de repuesto.
 */
function textoLibre(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const limpio = v.replace(/[<>]/g, '').trim().slice(0, max);
  return limpio || undefined;
}

/** Solo los campos con valor real — para no pisar datos buenos con cadenas vacías. */
function soloConValor(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// ─── Aplicar cada operación ──────────────────────────────────────────────────

/**
 * ¿Aparece el nombre tal cual en lo que se dijo? Guarda contra un fallo real y
 * repetible del modelo local: probado el 06/09/2026, ante "te presento a
 * ZZOtroTest" creó una ficha llamada "ZoetroTest". Un nombre mal copiado no
 * encuentra la persona existente, así que crea un duplicado — y el cerebro se
 * llena de "Ibon" e "Iban" que no se hablan entre sí. Si el nombre no está en
 * el texto, es invención del modelo y se descarta.
 */
const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function nombreApareceEnTexto(nombre: string, texto: string): boolean {
  return normalizar(texto).includes(normalizar(nombre));
}

// B3: además del log para consola, el llamador necesita el documento para
// poder calcular sus huecos y disparar la curiosidad — solo sobre la ficha que
// de verdad cambió en este turno, nunca sobre una que ya estaba al día.
interface ResultadoPersona { log: string; persona: IPerson; creado: boolean }

async function aplicarPersona(op: Operacion, origen: string, conversacion: string): Promise<ResultadoPersona | null> {
  const nombre = op.nombre?.trim();
  if (!nombre) return null;

  // El guardarraíl también aquí, no solo al crear: el prompt le da al modelo la
  // lista de todos los nombres conocidos, así que el fallo probable no es
  // inventarse un nombre sino **atribuir el dato a la persona equivocada**, que
  // además pisa datos buenos en vez de crear basura nueva.
  if (!nombreApareceEnTexto(nombre, conversacion)) {
    console.warn(`🧠 Descartada persona "${nombre}": ese nombre no aparece en la conversación`);
    return null;
  }

  // Busca por nombre o alias sin distinguir mayúsculas NI ACENTOS: el mismo
  // guardarraíl de arriba (`nombreApareceEnTexto`) ya normaliza acentos al
  // validar, así que un "Inigo" sin tilde debe encontrar a la "Íñigo" ya
  // existente en vez de crear un duplicado — justo el problema que este
  // guardarraíl dice evitar. La colección es pequeña, así que comparar en JS
  // sale más barato que mantener un índice de texto normalizado en Mongo.
  // Excluye `fuente:'manual'`: igual que `deduplicateAndSave` nunca deja que el
  // clasificador pise una Memory manual (invariante §7), una ficha creada a
  // mano en el panel no se toca desde la conversación — si de verdad coincide
  // el nombre, mejor un duplicado nuevo que una sobrescritura silenciosa.
  const target    = normalizar(nombre);
  const candidatas = await Person.find({ fuente: { $ne: 'manual' } });
  const existente  = candidatas.find(p =>
    normalizar(p.nombre) === target || p.alias.some(a => normalizar(a) === target)
  );

  const campos = soloConValor({
    relacion:    RELACIONES.includes(String(op.relacion)) ? op.relacion : undefined,
    descripcion: textoLibre(op.descripcion, 300),
    cumpleaños:  /^\d{2}-\d{2}$/.test(String(op.cumpleaños ?? '')) ? op.cumpleaños : undefined,
    ubicacion:   textoLibre(op.ubicacion, 120),
    trabajo:     textoLibre(op.trabajo, 120),
  });

  if (existente) {
    // Comparar contra el valor ya guardado, no solo mirar si el clasificador
    // mandó el campo: reenviar el mismo dato sin cambios (habitual si Ibon
    // vuelve a salir en una conversación) no debe pisar la trazabilidad del
    // último cambio real.
    let huboCambio = Object.entries(campos).some(([k, v]) => (existente as any)[k] !== v);
    Object.assign(existente, campos);
    // Las notas y conexiones se acumulan, no se reemplazan: son observaciones
    // sueltas y perder las viejas al añadir una nueva sería tirar memoria.
    for (const n of op.notas ?? [])      if (n && !existente.notas.includes(n))      { existente.notas.push(n); huboCambio = true; }
    for (const c of op.conexiones ?? []) if (c && !existente.conexiones.includes(c)) { existente.conexiones.push(c); huboCambio = true; }
    if (!huboCambio) return null;
    // `fuente` no se toca: dice cómo NACIÓ la ficha, y una creada a mano sigue
    // siéndolo aunque luego se actualice hablando. `origen` sí, porque guarda de
    // qué frase salió el último cambio — que es lo que hay que poder revisar.
    // Solo se pisa si de verdad hubo un cambio, para no perder la trazabilidad
    // del último cambio real por culpa de una propuesta que no aportaba nada.
    existente.origen = origen;
    await existente.save();
    // Una ficha desactivada no la ve nadie (ni el prompt ni `consultarCerebro`),
    // así que se avisa: el dato se guardó pero BAKO no lo usará. No se reactiva
    // sola porque desactivarla fue una decisión deliberada desde el panel.
    const oculta = existente.activo ? '' : ' ⚠️ (ficha desactivada: no se usará)';
    return { log: `👤 Persona actualizada: ${nombre} (${Object.keys(campos).join(', ') || 'notas'})${oculta}`, persona: existente, creado: false };
  }

  const persona = await Person.create({
    nombre,
    ...campos,
    notas:      op.notas ?? [],
    conexiones: op.conexiones ?? [],
    fuente:     'conversacion',
    origen,
  });
  return { log: `👤 Persona creada: ${nombre}`, persona, creado: true };
}

// ─── Curiosidad (B3, 17/09/2026) ───────────────────────────────────────────────
// Decisión del señor: nada de escaneo periódico ni de presupuesto por
// conversación — BAKO pregunta EN EL MOMENTO en que aprende o completa algo de
// verdad sobre alguien, "estilo niño aprendiendo": 2-3 preguntas curiosas sobre
// los huecos de esa ficha en concreto, nunca un formulario de campo en campo.

const CAMPOS_PERSONA: Array<{ campo: string; hueco: (p: IPerson) => boolean; pista: string }> = [
  { campo: 'relacion',    hueco: p => p.relacion === 'conocido', pista: 'qué relación tiene con el señor (familia, pareja, amistad, trabajo...)' },
  { campo: 'descripcion', hueco: p => !p.descripcion,            pista: 'quién es o a qué se dedica, en una frase' },
  { campo: 'ubicacion',   hueco: p => !p.ubicacion,               pista: 'dónde vive' },
  { campo: 'trabajo',     hueco: p => !p.trabajo,                 pista: 'en qué trabaja' },
  { campo: 'cumpleaños',  hueco: p => !p.cumpleaños,              pista: 'cuándo es su cumpleaños' },
];

/** Huecos reales de una ficha: vacíos y que todavía no se han preguntado nunca. */
function huecosDePersona(p: IPerson): Array<{ campo: string; pista: string }> {
  return CAMPOS_PERSONA.filter(c => c.hueco(p) && !p.preguntasHechas?.includes(c.campo));
}

/**
 * Redacta 2-3 preguntas naturales sobre los huecos de `persona` y las manda
 * como mensaje aparte (no en el turno en curso, para no añadirle latencia a
 * cada mensaje) por el mismo canal que ya usan los avisos de los crons —
 * llega a Telegram y a la cola de `Notification` que consultan PWA/Desktop.
 * Mismo proveedor que decidió el turno (invariante §3.3): si fue sensible, no
 * se llama a esta función en absoluto (ver `learnFromConversation`).
 */
async function preguntarPorHuecos(persona: IPerson, alaNube: boolean): Promise<void> {
  if (!persona.activo) return; // ficha desactivada a mano — nadie quiere que BAKO pregunte por ella
  const huecos = huecosDePersona(persona).slice(0, 3);
  if (!huecos.length) return;

  const conocido = [
    persona.relacion !== 'conocido' && `relación: ${persona.relacion}`,
    persona.descripcion && `descripción: ${persona.descripcion}`,
    persona.ubicacion && `vive en ${persona.ubicacion}`,
    persona.trabajo && `trabaja en ${persona.trabajo}`,
  ].filter(Boolean).join(' · ') || 'nada más todavía';

  const prompt = `Acabas de aprender o actualizar algo sobre "${persona.nombre}". Lo que ya sabes de `
    + `${persona.nombre}: ${conocido}. Sientes curiosidad genuina por completar el resto — como un niño `
    + `que acaba de conocer a alguien nuevo y quiere saberlo todo, pero sin agobiar. Escribe UN mensaje `
    + `breve y cálido para el señor con ${huecos.length} pregunta${huecos.length > 1 ? 's' : ''} sobre: `
    + `${huecos.map(h => h.pista).join('; ')}. Una sola frase de entrada + las preguntas, nada de listas `
    + `ni de markdown, trato de "señor".`;

  // `alaNube` es la decisión del TURNO, no de estos datos: si un turno sensible
  // anterior dejó algo delicado guardado en `descripcion`/`ubicacion`/`trabajo`
  // de esta misma ficha, ese texto viaja ahora dentro de `conocido` — y aunque
  // el turno actual no dispare `isSensitive`, el dato sí puede hacerlo. Mismo
  // criterio que ya aplica `consultar_cerebro` en `agent.ts` (hallazgo de
  // /code-review 17/09/2026): el contenido manda sobre el turno, nunca al
  // revés.
  const local = !alaNube || isSensitive(conocido);
  try {
    const texto = await askClaude(prompt, {
      maxTokens: 200, temperature: 0.7,
      ...(local ? { private: true } : { useCloud: true }),
    });
    const mensaje = texto.trim();
    // Una generación vacía/degenerada no es una pregunta real: si se marcara
    // igual como preguntado, el hueco quedaría cerrado para siempre sin que el
    // señor haya visto nada — hallazgo de /code-review 17/09/2026.
    if (!mensaje) { console.warn('🧠 Curiosidad: el modelo devolvió una respuesta vacía, se descarta'); return; }
    // Enviar ANTES de marcar como preguntado: si `sendSystemMessage` falla (bot
    // caído, Telegram sin responder...), el hueco debe seguir abierto para la
    // próxima oportunidad — marcarlo antes rompería "no insistir sin haber
    // preguntado de verdad" (hallazgo de /code-review 17/09/2026).
    const { sendSystemMessage } = await import('./telegram');
    await sendSystemMessage(`🧠 ${mensaje}`, mensaje);
    // `$addToSet`/`updateOne` en vez de reasignar el array en memoria y hacer
    // `persona.save()`: este documento se cargó antes de la llamada al LLM (que
    // puede tardar), así que un segundo turno sobre la misma ficha en paralelo
    // pisaría este guardado y borraría huecos ya marcados — hallazgo de
    // /code-review 17/09/2026.
    await Person.updateOne(
      { _id: persona._id },
      { $addToSet: { preguntasHechas: { $each: huecos.map(h => h.campo) } } }
    );
  } catch (err) {
    console.warn('🧠 Curiosidad: no se pudo redactar/enviar la pregunta:', (err as Error).message);
  }
}

async function aplicarConocimiento(op: Operacion, origen: string): Promise<string | null> {
  // snake_case en minúsculas: el prompt ya se lo pide al clasificador, pero sin
  // normalizar aquí una variación de mayúsculas/formato ("Rutina_Diaria" vs
  // "rutina_diaria") no encontraría la entrada existente y crearía un duplicado
  // — el mismo fallo que `normalizar()` ya evita para nombres de Persona.
  const clave = op.clave?.trim().toLowerCase().replace(/\s+/g, '_');
  const valor = op.valor?.trim();
  if (!clave || !valor) return null;

  const categoria = CATEGORIAS.includes(op.categoria as KnowledgeCategory)
    ? (op.categoria as KnowledgeCategory)
    : 'otro';
  const importancia: 'alta' | 'media' | 'baja' =
    ['alta', 'media', 'baja'].includes(String(op.importancia)) ? (op.importancia as any) : 'media';

  // La identidad de una entrada es `categoria/clave`, que es como se le presenta
  // al clasificador: buscar solo por `clave` haría que un mismo nombre en dos
  // categorías se pisara silenciosamente (y el log cantaría la categoría que no
  // es, porque imprime la propuesta, no la del registro tocado). Sin filtrar por
  // `activo`, igual que en `aplicarPersona`: si no, una entrada desactivada es
  // invisible para esta búsqueda y el tema reaparece como un duplicado nuevo en
  // vez de actualizar el original. `fuente:'manual'` sí se excluye — invariante
  // §7: lo curado a mano en el panel no se pisa desde la conversación.
  const existente = await KnowledgeEntry.findOne({ categoria, clave, fuente: { $ne: 'manual' } });
  if (existente) {
    const detallesNuevos = (op.detalles ?? []).filter(d => d && !existente.detalles.includes(d));
    const huboCambio = existente.valor !== valor || existente.importancia !== importancia || detallesNuevos.length > 0;
    if (!huboCambio) return null;
    existente.valor       = valor;
    existente.importancia = importancia;
    existente.origen      = origen; // de qué frase salió el último cambio
    existente.detalles.push(...detallesNuevos);
    await existente.save();
    // Igual que con Person: una entrada desactivada no se reactiva sola (fue
    // una decisión deliberada desde el panel), pero sí se avisa de que el dato
    // se guardó y no se va a usar.
    const oculta = existente.activo ? '' : ' ⚠️ (desactivada: no se usará)';
    return `📚 Conocimiento actualizado: ${categoria}/${clave}${oculta}`;
  }

  await KnowledgeEntry.create({
    categoria, clave, valor,
    detalles: op.detalles ?? [],
    importancia,
    fuente: 'conversacion',
    origen,
  });
  return `📚 Conocimiento nuevo: ${categoria}/${clave}`;
}

const TIPOS_RECUERDO = ['fact', 'preference', 'project_update', 'decision', 'feeling'];

async function aplicarRecuerdo(op: Operacion, privado: boolean): Promise<string | null> {
  const contenido = op.contenido?.trim();
  if (!contenido || contenido.length < 10) return null;

  // El prompt convive con dos escalas de importancia — alta|media|baja para el
  // conocimiento y high|medium|low para los recuerdos — así que el modelo mezcla
  // las dos. Sin validar, un "alta" aquí revienta el enum de Mongoose y el
  // recuerdo se pierde en silencio. Se traduce lo traducible y se valida el resto.
  const equivalencias: Record<string, string> = { alta: 'high', media: 'medium', baja: 'low' };
  const bruta      = String(op.importancia ?? '').toLowerCase();
  const importance = ['high', 'medium', 'low'].includes(bruta) ? bruta : (equivalencias[bruta] ?? 'medium');
  const type       = TIPOS_RECUERDO.includes(String(op.tipo)) ? String(op.tipo) : 'fact';

  // `privado` viaja hasta aquí: el gate de sensibilidad de más arriba no sirve
  // de nada si luego el embedding o la decisión ACTUALIZAR/CREAR de
  // deduplicateAndSave se van a Cloudflare/Groq por su cuenta (invariante §3.3).
  await deduplicateAndSave({
    content:    contenido,
    type:       type as any,
    importance: importance as any,
    tags:       Array.isArray(op.tags) ? op.tags.filter(t => typeof t === 'string') : [],
  }, { privado });
  return `🧠 Recuerdo: ${contenido.slice(0, 60)}`;
}

/**
 * Sustituye a `extractAndSaveMemories`: además de extraer, decide la caja.
 * Falla en silencio a propósito (aprender no es crítico), pero deja rastro en
 * el log — antes un JSON mal formado del modelo local no se notaba en absoluto.
 */
export async function learnFromConversation(
  userMessage: string,
  assistantResponse: string,
  opts: {
    // Lo que el llamador sabe y aquí no se puede deducir: el gate de /text mira
    // también el historial de la conversación, y este clasificador solo ve el
    // turno suelto. Suma al cálculo de abajo, nunca resta.
    sensible?: boolean;
    forzarProveedor?: boolean; // solo para pruebas; en producción decide la regla de privacidad
  } = {},
): Promise<void> {
  try {
    // Clasificar es una tarea de razonamiento estructurado que el modelo local
    // no aguanta: medido el 06/09/2026 con "he conocido a X, amigo de Julen que
    // vive en Hernani y es profesor", qwen3:8b devolvió [] y Groq creó la ficha
    // completa, incluida la conexión con Julen. Así que se clasifica en la nube
    // —salvo que el turno toque contenido sensible, que por el invariante §3.3
    // no sale de local aunque eso signifique aprender menos de él.
    // El OR es lo importante: `isSensitive` es léxico y solo ve este turno, así
    // que "¿cuánto te dije que cobraba?" → "2.400 € netos, señor" no dispara
    // ninguna palabra del patrón. Si la ruta ya decidió que el turno era sensible
    // —porque lo era el historial— esa decisión manda, o la cifra que el gate
    // acababa de retener saldría a Groq por la puerta de atrás del aprendizaje.
    const sensible = opts.sensible === true || isSensitive(`${userMessage}\n${assistantResponse}`);
    const alaNube  = opts.forzarProveedor ?? !sensible;
    if (sensible) console.log('🧠 Clasificador: turno sensible → solo local');

    const snap = await loQueYaSabe(alaNube);

    // `useCloud:false` NO garantiza local: `askClaude` cae a Groq y luego a
    // OpenRouter si Ollama no responde, así que un turno sensible acabaría en la
    // nube mientras el log dice lo contrario. `private:true` es lo que corta esa
    // cadena y lanza PrivacyError en vez de salir fuera — lo mismo que ya hacía
    // el manejador de Telegram.
    let raw: string;
    try {
      raw = await askClaude(`Usuario: ${userMessage}\nBAKO: ${assistantResponse}`, {
        systemPrompt: promptClasificador(snap),
        maxTokens:    600,
        temperature:  0,
        ...(alaNube ? { useCloud: true } : { private: true }),
      });
    } catch (err) {
      // Distinguir el peldaño que falló: si el turno iba a la nube, un log que
      // diga "local" apunta a Ollama cuando el problema real fue Groq/OpenRouter.
      console.warn(`🧠 Clasificador: no se pudo clasificar en ${alaNube ? 'la nube' : 'local'}, se descarta el turno`);
      return;
    }

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) { console.warn('🧠 Clasificador: el modelo no devolvió JSON'); return; }

    let ops: Operacion[];
    try { ops = JSON.parse(match[0]); }
    catch { console.warn('🧠 Clasificador: JSON inválido'); return; }
    if (!Array.isArray(ops) || !ops.length) {
      // Se registra a propósito: sin esto, "no había nada que guardar" y "el
      // modelo no supo clasificarlo" son indistinguibles desde fuera.
      console.log('🧠 Clasificador: nada que guardar en este turno');
      return;
    }
    console.log(`🧠 Clasificador: ${ops.length} operación(es) propuesta(s)`);

    const origen       = userMessage.slice(0, 300);
    const conversacion = `${userMessage}\n${assistantResponse}`;
    // B3: como mucho una ficha de Persona se lleva la curiosidad de este turno
    // — la creada manda sobre la actualizada ("preguntas encadenadas: nombre
    // nuevo antes que algo aleatorio" de plan.md), y entre varias creadas, la
    // primera que proponga el clasificador.
    // Se guarda el _id, no el documento: si el clasificador propone dos
    // operaciones sobre la misma persona en el mismo turno (crear + actualizar,
    // p. ej.), el documento en memoria de la primera queda obsoleto en cuanto la
    // segunda toca Mongo — hallazgo de /code-review 17/09/2026. Releer justo
    // antes de preguntar garantiza los huecos reales, sin importar cuántas
    // operaciones tocaran la ficha durante el bucle.
    let candidatoId: unknown;
    let candidatoCreado = false; // para que un segundo "crear" no desplace al primero
    for (const op of ops) {
      try {
        if (op.caja === 'persona') {
          const resultado = await aplicarPersona(op, origen, conversacion);
          if (resultado) {
            console.log(`🧠 ${resultado.log}`);
            if (!candidatoId || (resultado.creado && !candidatoCreado)) {
              candidatoId     = resultado.persona._id;
              candidatoCreado = resultado.creado;
            }
          }
        } else if (op.caja === 'conocimiento') {
          const resultado = await aplicarConocimiento(op, origen);
          if (resultado) console.log(`🧠 ${resultado}`);
        } else if (op.caja === 'recuerdo' || op.contenido) { // sin caja reconocida → recuerdo
          const resultado = await aplicarRecuerdo(op, sensible);
          if (resultado) console.log(`🧠 ${resultado}`);
        }
      } catch (err) {
        console.warn(`🧠 Clasificador: falló una operación (${op.caja}):`, (err as Error).message);
      }
    }

    // Nunca sobre un turno sensible: ni la pregunta se redacta ni el mensaje
    // sale — invariante §3.3, igual que el resto de este clasificador.
    if (candidatoId && !sensible) {
      const persona = await Person.findById(candidatoId);
      if (persona) await preguntarPorHuecos(persona, alaNube);
    }
  } catch (err) {
    console.warn('🧠 Clasificador falló:', (err as Error).message);
  }
}

// ─── Consulta ────────────────────────────────────────────────────────────────

/**
 * Qué sabe BAKO sobre algo, mirando las tres cajas. Existe para que pueda
 * responder "¿qué sabes de Ibon?" sin depender de que esa ficha haya entrado
 * en el presupuesto de caracteres del prompt.
 */
export async function consultarCerebro(tema: string): Promise<string> {
  const t = tema.trim();
  if (!t) return 'No sé sobre qué quiere que busque, señor.';
  const rx = new RegExp(escapeRegex(t), 'i');

  // §3.3: si el propio tema es sensible, la búsqueda semántica no puede
  // arriesgarse a embeberlo en Cloudflare si Ollama no responde.
  const privado = isSensitive(t);
  const [personas, conocimiento, recuerdos] = await Promise.all([
    Person.find({ activo: true, $or: [{ nombre: rx }, { alias: rx }, { descripcion: rx }, { notas: rx }] }).limit(5),
    KnowledgeEntry.find({ activo: true, $or: [{ clave: rx }, { valor: rx }, { detalles: rx }] }).limit(5),
    searchMemories(t, { privado }).then(r => r.slice(0, 5)).catch(() => []),
  ]);

  const partes: string[] = [];

  for (const p of personas) {
    const campos = [
      p.descripcion && p.descripcion,
      p.relacion   && `relación: ${p.relacion}`,
      p.ubicacion  && `vive en ${p.ubicacion}`,
      p.trabajo    && `trabaja en ${p.trabajo}`,
      p.cumpleaños && `cumple el ${p.cumpleaños}`,
      p.notas?.length ? p.notas.join('. ') : '',
    ].filter(Boolean);
    partes.push(`PERSONA ${p.nombre}: ${campos.join(' · ')}`);
  }
  for (const k of conocimiento) {
    partes.push(`CONOCIMIENTO (${k.categoria}/${k.clave}): ${k.valor}${k.detalles?.length ? ' · ' + k.detalles.join('. ') : ''}`);
  }
  for (const m of recuerdos) {
    const fecha = new Date(m.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    partes.push(`RECUERDO (${fecha}): ${m.content}`);
  }

  if (!partes.length) return `No tengo nada guardado sobre "${t}", señor.`;
  return partes.join('\n');
}

// ─── Olvidar ─────────────────────────────────────────────────────────────────

/**
 * Borrado hablado — B2.5 del plan. A diferencia de crear/actualizar (que corren
 * en background sin pedir permiso), esto es destructivo: se registra como tool
 * explícita con `destructive:true` en `agent.ts`, así que ya pasa por el gate de
 * confirmación de B0 antes de que `run()` llegue a ejecutarse aquí.
 *
 * Soft-delete (`activo:false`), no borrado físico — coherente con cómo ya se
 * marcan las fichas desactivadas en `aplicarPersona`/`aplicarConocimiento`, y
 * reversible desde el panel si el clasificador se equivocó de ficha.
 *
 * Una ficha `fuente:'manual'` no se toca por voz, igual que el invariante §7
 * protege las memorias manuales: lo que el señor curó a mano en el panel no
 * desaparece porque el clasificador entienda mal un nombre parecido.
 */
export async function olvidarPersona(nombre: string): Promise<string> {
  const t = nombre.trim();
  if (!t) return 'No sé a quién quiere que olvide, señor.';

  const target = normalizar(t);
  const candidatas = (await Person.find({ activo: true })).filter(p =>
    normalizar(p.nombre) === target || p.alias.some(a => normalizar(a) === target)
  );
  if (!candidatas.length) return `No tengo ninguna ficha activa de "${t}", señor.`;
  // Dos personas con el mismo nombre/alias no deberían existir, pero si pasa,
  // desactivar la primera que devuelva Mongo sería jugársela a qué ficha es la
  // correcta — mismo criterio de desambiguación que `olvidarConocimiento`.
  if (candidatas.length > 1) {
    return `Hay ${candidatas.length} personas activas llamadas "${t}", señor. No puedo elegir por usted — desactive la ficha correcta desde el panel.`;
  }

  const existente = candidatas[0];
  if (existente.fuente === 'manual') {
    return `La ficha de ${existente.nombre} se creó a mano desde el panel — bórrela desde ahí, señor.`;
  }

  existente.activo = false;
  await existente.save();
  return `👤 Persona olvidada: ${existente.nombre}. Sigue en la base de datos por si hace falta recuperarla, pero BAKO no la usará.`;
}

export async function olvidarConocimiento(tema: string): Promise<string> {
  const t = tema.trim();
  if (!t) return 'No sé qué conocimiento quiere que olvide, señor.';

  const rx = new RegExp(escapeRegex(t), 'i');
  const candidatos = await KnowledgeEntry.find({ activo: true, $or: [{ clave: rx }, { valor: rx }] });

  if (!candidatos.length) return `No tengo ningún conocimiento activo que coincida con "${t}", señor.`;
  if (candidatos.length > 1) {
    const opciones = candidatos.map(k => `${k.categoria}/${k.clave}`).join(', ');
    return `Hay varias entradas que coinciden con "${t}" (${opciones}). Dígame la clave exacta.`;
  }

  const existente = candidatos[0];
  if (existente.fuente === 'manual') {
    return `La entrada ${existente.categoria}/${existente.clave} se creó a mano desde el panel — bórrela desde ahí, señor.`;
  }

  existente.activo = false;
  await existente.save();
  return `📚 Conocimiento olvidado: ${existente.categoria}/${existente.clave}. Sigue en la base de datos por si hace falta recuperarlo, pero BAKO no lo usará.`;
}
