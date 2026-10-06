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
import { Project } from '../memory/Project';
import { IMemory } from '../memory/Memory';
import { KnowledgeEntry, KnowledgeCategory } from '../memory/KnowledgeEntry';
import { Relation, RelationEntityType, confianzaLabel } from '../memory/Relation';
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
- "relacion": una conexión explícita y REAL entre dos piezas del cerebro — el señor la dijo, no la
  inventes. Persona-persona, persona-proyecto o persona-conocimiento. Campos: origenTipo y
  destinoTipo (persona|proyecto|conocimiento), origenNombre y destinoNombre (para "conocimiento" usa
  "categoria/clave"), y relacion con una etiqueta breve ("trabaja en", "es pareja de", "vive con",
  "depende de"...).

YA EXISTEN estas personas: ${snap.personas.length ? snap.personas.join(', ') : '(ninguna)'}
YA EXISTE este conocimiento (categoria/clave): ${snap.claves.length ? snap.claves.join(', ') : '(ninguno)'}

Si el dato afecta a algo que YA EXISTE, usa "actualizar" e incluye SOLO los campos que cambian.
Si es nuevo, usa "crear".

NO guardes: consultas de tiempo, noticias o la hora; saludos; eventos de calendario con fecha y hora
(el calendario es su propia fuente de verdad); nada que ya conste arriba sin cambios; ni lo que diga
BAKO sobre sí mismo (qué modelo usa, dónde se ejecuta), ni las quejas o correcciones sobre cómo se
comporta BAKO ("no me haces preguntas", "contestas mal"): eso es conversación, no un recuerdo ni una
preferencia de Borja. Tampoco estos campos CUANDO SON DEL PROPIO
BORJA — de las demás personas sí se guardan en su ficha, que para eso está la caja "persona":
${CAMPOS_DE_PERFIL}. Esos ocho tienen su propia ficha de perfil y su propio cauce de actualización
("ya no trabajo en X", "me he mudado a Y", "nací el 12/03/1990"). Ojo: la rutina, los hábitos y los horarios de Borja SÍ son conocimiento y se
guardan en la caja "conocimiento" con categoria "rutina".

Responde ÚNICAMENTE con un array JSON, sin texto alrededor:
[
  {"caja":"persona","accion":"crear|actualizar","nombre":"...","relacion":"...","ubicacion":"...","trabajo":"","descripcion":"","cumpleaños":"","notas":[],"conexiones":[]},
  {"caja":"conocimiento","accion":"crear|actualizar","categoria":"...","clave":"...","valor":"...","detalles":[],"importancia":"alta|media|baja"},
  {"caja":"recuerdo","contenido":"...","tipo":"fact|preference|project_update|decision|feeling","importancia":"high|medium|low","tags":["..."]},
  {"caja":"relacion","origenTipo":"persona|proyecto|conocimiento","origenNombre":"...","destinoTipo":"persona|proyecto|conocimiento","destinoNombre":"...","relacion":"..."}
]
Si no hay nada que merezca guardarse, responde exactamente: []`;
}

interface Operacion {
  caja?: string; accion?: string;
  nombre?: string; relacion?: string; descripcion?: string; cumpleaños?: string;
  ubicacion?: string; trabajo?: string; notas?: string[]; conexiones?: string[];
  categoria?: string; clave?: string; valor?: string; detalles?: string[]; importancia?: string;
  contenido?: string; tipo?: string; tags?: string[];
  // B4: caja "relacion" — conexión tipada entre dos entidades del cerebro
  origenTipo?: string; origenNombre?: string; destinoTipo?: string; destinoNombre?: string;
  confianza?: number; explicacion?: string; // solo se usan en la propuesta de deducción (deducirConexiones)
}

// B4.4: un cambio de un valor real a otro distinto (no de vacío a lleno, eso es
// completar un hueco de B3) es candidato a contradicción — se guarda igualmente
// el valor nuevo (no se bloquea nada), pero se avisa en vez de callarlo.
interface Contradiccion {
  entidadTipo: 'persona' | 'conocimiento';
  entidadNombre: string;
  campo: string;
  anterior: string;
  nuevo: string;
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

/**
 * Busca personas cuyo nombre o alg\u00fan alias coincida (sin may\u00fasculas ni
 * acentos) con `nombre`, dentro del filtro Mongo dado. Centraliza una
 * comparaci\u00f3n que se repet\u00eda suelta en tres sitios (`aplicarPersona`,
 * `resolverEntidad`, `olvidarPersona`) \u2014 cada uno con su propio filtro
 * (`fuente`/`activo`) pero la misma l\u00f3gica de comparaci\u00f3n.
 */
async function personasPorNombre(nombre: string, filtro: Record<string, any> = {}): Promise<IPerson[]> {
  const target = normalizar(nombre);
  const candidatas = await Person.find(filtro);
  return candidatas.filter(p => normalizar(p.nombre) === target || p.alias.some(a => normalizar(a) === target));
}

function nombreApareceEnTexto(nombre: string, texto: string): boolean {
  return normalizar(texto).includes(normalizar(nombre));
}

// B3: además del log para consola, el llamador necesita el documento para
// poder calcular sus huecos y disparar la curiosidad — solo sobre la ficha que
// de verdad cambió en este turno, nunca sobre una que ya estaba al día.
interface ResultadoPersona { log: string; persona: IPerson; creado: boolean; contradicciones: Contradiccion[] }

// Campos "factuales" de Persona: cambiar de un valor real a otro distinto es
// sospechoso de contradicción. `descripcion` y `notas` se excluyen a propósito
// — se acumulan/refinan con el tiempo, sobrescribirlas no es una contradicción.
const CAMPOS_CONTRADECIBLES_PERSONA = ['relacion', 'ubicacion', 'trabajo', 'cumpleaños'];

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
  const existente = (await personasPorNombre(nombre, { fuente: { $ne: 'manual' } }))[0];

  const campos = soloConValor({
    relacion:    RELACIONES.includes(String(op.relacion)) ? op.relacion : undefined,
    descripcion: textoLibre(op.descripcion, 300),
    cumpleaños:  /^\d{2}-\d{2}$/.test(String(op.cumpleaños ?? '')) ? op.cumpleaños : undefined,
    ubicacion:   textoLibre(op.ubicacion, 120),
    trabajo:     textoLibre(op.trabajo, 120),
  });

  if (existente) {
    // B4.4: capturar ANTES de sobrescribir — un valor real que cambia a otro
    // distinto (no de vacío a lleno) es candidato a contradicción.
    const contradicciones: Contradiccion[] = [];
    for (const campo of CAMPOS_CONTRADECIBLES_PERSONA) {
      const anterior = (existente as any)[campo];
      const nuevo    = (campos as any)[campo];
      // "conocido" es el valor por DEFECTO del esquema (nunca se eligió de
      // verdad): pasar de ahí a algo concreto es completar un hueco de B3, no
      // una contradicción — `huecosDePersona` ya trata "conocido" como vacío.
      if (campo === 'relacion' && anterior === 'conocido') continue;
      if (anterior && nuevo && anterior !== nuevo) {
        contradicciones.push({ entidadTipo: 'persona', entidadNombre: nombre, campo, anterior: String(anterior), nuevo: String(nuevo) });
      }
    }

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
    return { log: `👤 Persona actualizada: ${nombre} (${Object.keys(campos).join(', ') || 'notas'})${oculta}`, persona: existente, creado: false, contradicciones };
  }

  const persona = await Person.create({
    nombre,
    ...campos,
    notas:      op.notas ?? [],
    conexiones: op.conexiones ?? [],
    fuente:     'conversacion',
    origen,
  });
  return { log: `👤 Persona creada: ${nombre}`, persona, creado: true, contradicciones: [] };
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
 * Curiosidad en menciones: si el señor nombra a una persona activa con huecos, BAKO
 * pregunta aunque el clasificador no haya creado ni cambiado su ficha en este turno.
 * Solo se mira el mensaje del señor, nunca la respuesta de BAKO, y el nombre tiene que
 * aparecer como palabra entera ("Ana" no debe coincidir con "anatomía").
 */
async function personaMencionadaConHuecos(mensaje: string): Promise<IPerson | null> {
  const texto = normalizar(mensaje).toLowerCase();
  const candidatas = await Person.find({ activo: true });
  for (const p of candidatas) {
    if (!huecosDePersona(p).length) continue;
    const nombres = [p.nombre, ...p.alias].filter(Boolean);
    const menciona = nombres.some(n => {
      const nombre = escapeRegex(normalizar(n).toLowerCase());
      return new RegExp(`(^|[^a-z0-9ñ])${nombre}($|[^a-z0-9ñ])`).test(texto);
    });
    if (menciona) return p;
  }
  return null;
}

/**
 * Redacta 2-3 preguntas naturales sobre los huecos de `persona` y las manda
 * como mensaje aparte (no en el turno en curso, para no añadirle latencia a
 * cada mensaje) por el mismo canal que ya usan los avisos de los crons —
 * llega a Telegram y a la cola de `Notification` que consultan PWA/Desktop.
 * Mismo proveedor que decidió el turno (invariante §3.3): si fue sensible, no
 * se llama a esta función en absoluto (ver `learnFromConversation`).
 */
async function preguntarPorHuecos(persona: IPerson, alaNube: boolean, origen: 'turno' | 'mencion' = 'turno'): Promise<void> {
  if (!persona.activo) return; // ficha desactivada a mano — nadie quiere que BAKO pregunte por ella
  const huecos = huecosDePersona(persona).slice(0, 3);
  if (!huecos.length) return;

  const conocido = [
    persona.relacion !== 'conocido' && `relación: ${persona.relacion}`,
    persona.descripcion && `descripción: ${persona.descripcion}`,
    persona.ubicacion && `vive en ${persona.ubicacion}`,
    persona.trabajo && `trabaja en ${persona.trabajo}`,
  ].filter(Boolean).join(' · ') || 'nada más todavía';

  // Una mención no es un aprendizaje: el prompt no puede afirmar que BAKO acaba de aprender algo
  const intro = origen === 'mencion'
    ? `El señor acaba de nombrar a "${persona.nombre}" en la conversación.`
    : `Acabas de aprender o actualizar algo sobre "${persona.nombre}".`;
  const prompt = `${intro} Lo que ya sabes de `
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

async function aplicarConocimiento(op: Operacion, origen: string): Promise<{ log: string; contradicciones: Contradiccion[] } | null> {
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

    // B4.4: el propio VALOR cambiando de uno real a otro distinto es la señal —
    // no se bloquea el guardado (se sigue aplicando lo más reciente), pero se
    // avisa en vez de callarlo, como pide el plan.
    const contradicciones: Contradiccion[] = [];
    if (existente.valor && existente.valor !== valor) {
      contradicciones.push({ entidadTipo: 'conocimiento', entidadNombre: `${categoria}/${clave}`, campo: 'valor', anterior: existente.valor, nuevo: valor });
    }

    existente.valor       = valor;
    existente.importancia = importancia;
    existente.origen      = origen; // de qué frase salió el último cambio
    existente.detalles.push(...detallesNuevos);
    await existente.save();
    // Igual que con Person: una entrada desactivada no se reactiva sola (fue
    // una decisión deliberada desde el panel), pero sí se avisa de que el dato
    // se guardó y no se va a usar.
    const oculta = existente.activo ? '' : ' ⚠️ (desactivada: no se usará)';
    return { log: `📚 Conocimiento actualizado: ${categoria}/${clave}${oculta}`, contradicciones };
  }

  await KnowledgeEntry.create({
    categoria, clave, valor,
    detalles: op.detalles ?? [],
    importancia,
    fuente: 'conversacion',
    origen,
  });
  return { log: `📚 Conocimiento nuevo: ${categoria}/${clave}`, contradicciones: [] };
}

// ─── B4: relaciones tipadas, deducción y contradicciones ────────────────────

/**
 * Resuelve un nombre propuesto por el LLM a una entidad que YA EXISTE en la
 * base (nunca crea nada nuevo por esta vía). `exigirMencion=true` reutiliza el
 * mismo guardarraíl que `aplicarPersona` contra nombres inventados — para una
 * relación DICHA por el señor, el nombre debe aparecer en lo que dijo. Para una
 * deducción (`deducirConexiones`) se relaja: por definición conecta cosas que
 * no se nombraron juntas en esta frase, pero deben existir igualmente.
 */
async function resolverEntidad(
  tipo: string | undefined,
  nombre: string | undefined,
  conversacion: string,
  exigirMencion: boolean = true,
): Promise<{ tipo: RelationEntityType; id: any; nombre: string } | null> {
  const t = String(tipo ?? '').trim();
  const n = nombre?.trim();
  if (!n || (t !== 'persona' && t !== 'proyecto' && t !== 'conocimiento')) return null;
  // Para persona/proyecto el nombre propuesto debe aparecer tal cual en lo
  // dicho (mismo guardarraíl que `aplicarPersona`). Para "conocimiento" el
  // identificador es interno ("categoria/clave") y nunca aparece así en una
  // frase hablada, así que se exige en su lugar más abajo que al menos una
  // palabra real de la CLAVE aparezca en el texto — sin esto, una relación
  // "dicha" (confianza 1) podría apuntar a una entrada de conocimiento que el
  // señor nunca mencionó en este turno.
  if (exigirMencion && t !== 'conocimiento' && !nombreApareceEnTexto(n, conversacion)) return null;

  if (t === 'persona') {
    const p = (await personasPorNombre(n, { activo: true }))[0];
    return p ? { tipo: 'persona', id: p._id, nombre: p.nombre } : null;
  }
  if (t === 'proyecto') {
    const target = normalizar(n);
    const pr = (await Project.find({ activo: true })).find(x =>
      normalizar(x.nombre) === target || normalizar(x.slug) === target);
    return pr ? { tipo: 'proyecto', id: pr._id, nombre: pr.nombre } : null;
  }
  // "conocimiento": el nombre llega como "categoria/clave"
  const [cat, ...resto] = n.split('/');
  const clave = resto.join('/').trim().toLowerCase().replace(/\s+/g, '_');
  if (!clave || !CATEGORIAS.includes(cat.trim() as KnowledgeCategory)) return null;
  if (exigirMencion) {
    const palabras = clave.split('_').filter(w => w.length > 2);
    if (!palabras.some(w => nombreApareceEnTexto(w, conversacion))) return null;
  }
  const k = await KnowledgeEntry.findOne({ activo: true, categoria: cat.trim() as KnowledgeCategory, clave });
  return k ? { tipo: 'conocimiento', id: k._id, nombre: `${k.categoria}/${k.clave}` } : null;
}

/** B4.1 — aplica una relación DICHA explícitamente por el señor. */
async function aplicarRelacion(op: Operacion, origen: string, conversacion: string): Promise<string | null> {
  const [a, b] = await Promise.all([
    resolverEntidad(op.origenTipo, op.origenNombre, conversacion),
    resolverEntidad(op.destinoTipo, op.destinoNombre, conversacion),
  ]);
  const etiqueta = textoLibre(op.relacion, 80);
  if (!a || !b || !etiqueta) return null;
  if (a.tipo === b.tipo && String(a.id) === String(b.id)) return null; // no se relaciona consigo misma

  const existente = await Relation.findOne({
    origenTipo: a.tipo, origenId: a.id, destinoTipo: b.tipo, destinoId: b.id,
    relacion: new RegExp(`^${escapeRegex(etiqueta)}$`, 'i'), fuente: { $ne: 'manual' },
  });

  if (existente) {
    // Reconfirmar una relación ya dicha antes solo refresca `updatedAt` (para
    // la caducidad de B4.5) sin generar ruido en el log cada vez que se repite.
    const yaConfirmada = existente.activo && existente.dicha;
    existente.activo      = true;
    existente.dicha       = true;
    existente.confianza   = 1;
    existente.explicacion = origen;
    await existente.save();
    return yaConfirmada ? null : `🔗 Relación confirmada: ${a.nombre} — ${etiqueta} — ${b.nombre}`;
  }

  await Relation.create({
    origenTipo: a.tipo, origenId: a.id, origenNombre: a.nombre,
    destinoTipo: b.tipo, destinoId: b.id, destinoNombre: b.nombre,
    relacion: etiqueta, dicha: true, confianza: 1, explicacion: origen, fuente: 'conversacion',
  });
  return `🔗 Relación nueva: ${a.nombre} — ${etiqueta} — ${b.nombre}`;
}

/**
 * B4.2 — deducción. No todo lo relevante se dice explícitamente: mira el
 * vecindario de 1 salto de la entidad tocada este turno (sus relaciones
 * activas) y pregunta al LLM si hay algo razonable que deducir. Guardarraíles:
 * nunca inventa una entidad nueva (`resolverEntidad` solo encuentra lo que ya
 * existe), y cualquier propuesta por debajo de confianza 0.5 se descarta para
 * no llenar el cerebro de ruido. Es un extra, nunca crítico — cualquier fallo
 * se traga en silencio, igual que `preguntarPorHuecos` de B3.
 */
async function deducirConexiones(
  entidad: { tipo: RelationEntityType; id: any; nombre: string },
  conversacion: string,
  alaNube: boolean,
): Promise<void> {
  try {
    const relacionesExistentes = await Relation.find({
      activo: true,
      $or: [
        { origenTipo: entidad.tipo, origenId: entidad.id },
        { destinoTipo: entidad.tipo, destinoId: entidad.id },
      ],
    }).limit(20);

    if (!relacionesExistentes.length) return; // sin vecindario, nada que conectar

    const contexto = relacionesExistentes.map(r =>
      `${r.origenNombre} (${r.origenTipo}) —${r.relacion}→ ${r.destinoNombre} (${r.destinoTipo})`
      + (r.dicha ? '' : ` [ya es una deducción, confianza ${r.confianza}]`)
    ).join('\n');

    const prompt = `Conexiones ya conocidas relacionadas con "${entidad.nombre}":\n${contexto}\n\n`
      + `Última conversación: "${conversacion.slice(0, 500)}"\n\n`
      + `¿Se puede DEDUCIR razonablemente alguna conexión NUEVA, no dicha explícitamente, que no conste `
      + `ya arriba? Solo entre cosas que YA EXISTAN — no inventes personas, proyectos ni datos nuevos. Si `
      + `no hay nada razonable, responde exactamente []. Si hay algo, responde SOLO un array JSON: `
      + `[{"origenTipo":"persona|proyecto|conocimiento","origenNombre":"...","destinoTipo":"persona|proyecto|conocimiento","destinoNombre":"...","relacion":"...","confianza":0.0,"explicacion":"por qué se deduce, una frase"}]`;

    // `alaNube` es la decisión del TURNO (isSensitive solo mira el mensaje
    // suelto), pero `contexto` trae relaciones ya guardadas de OTROS turnos —
    // que pueden ser sensibles aunque este turno no lo parezca. Mismo criterio
    // que ya aplica `preguntarPorHuecos`/`preguntarPorContradiccion`: el
    // contenido manda sobre el turno, nunca al revés (invariante §3.3).
    const local = !alaNube || isSensitive(contexto);
    let raw: string;
    try {
      raw = await askClaude(prompt, {
        maxTokens: 400, temperature: 0.2,
        ...(local ? { private: true } : { useCloud: true }),
      });
    } catch { return; }

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;
    let propuestas: Operacion[];
    try { propuestas = JSON.parse(match[0]); } catch { return; }
    if (!Array.isArray(propuestas) || !propuestas.length) return;

    for (const p of propuestas) {
      const confianza = typeof p.confianza === 'number' ? Math.max(0, Math.min(1, p.confianza)) : 0;
      if (confianza < 0.5) continue; // ruido por debajo del umbral, se descarta

      const [a, b] = await Promise.all([
        resolverEntidad(p.origenTipo, p.origenNombre, conversacion, false),
        resolverEntidad(p.destinoTipo, p.destinoNombre, conversacion, false),
      ]);
      const etiqueta    = textoLibre(p.relacion, 80);
      const explicacion = textoLibre(p.explicacion, 300) ?? '';
      if (!a || !b || !etiqueta) continue;
      if (a.tipo === b.tipo && String(a.id) === String(b.id)) continue;

      // Si esta MISMA etiqueta ya consta como HECHO dicho, no tiene sentido
      // "deducirla" también — pero dos entidades pueden tener varias relaciones
      // distintas a la vez ("trabaja en" Y "depende de"), así que el filtro por
      // `relacion` es imprescindible: sin él, cualquier relación dicha ya
      // existente entre las mismas dos entidades bloquearía TODAS las demás
      // deducciones sobre ese mismo par, aunque no tuvieran nada que ver.
      const yaDicha = await Relation.findOne({
        origenTipo: a.tipo, origenId: a.id, destinoTipo: b.tipo, destinoId: b.id, activo: true, dicha: true,
        relacion: new RegExp(`^${escapeRegex(etiqueta)}$`, 'i'),
      });
      if (yaDicha) continue;

      // `fuente:'manual'` excluida, igual que en `aplicarRelacion` (invariante
      // §7): si algún día el panel permite curar una Relation a mano, esta
      // deducción en segundo plano no debe pisarla en silencio.
      const existente = await Relation.findOne({
        origenTipo: a.tipo, origenId: a.id, destinoTipo: b.tipo, destinoId: b.id,
        relacion: new RegExp(`^${escapeRegex(etiqueta)}$`, 'i'), dicha: false, fuente: { $ne: 'manual' },
      });
      if (existente) {
        existente.confianza   = confianza;
        existente.explicacion = explicacion || existente.explicacion;
        existente.activo      = true;
        await existente.save();
        continue;
      }

      await Relation.create({
        origenTipo: a.tipo, origenId: a.id, origenNombre: a.nombre,
        destinoTipo: b.tipo, destinoId: b.id, destinoNombre: b.nombre,
        relacion: etiqueta, dicha: false, confianza, explicacion, fuente: 'conversacion',
      });
      console.log(`🧠 Deducción: ${a.nombre} —${etiqueta}→ ${b.nombre} (confianza ${confianza})`);
    }
  } catch (err) {
    console.warn('🧠 Deducción: falló el paso de conexiones:', (err as Error).message);
  }
}

/**
 * B4.4 — pregunta por una posible contradicción en vez de callarla. El valor
 * nuevo ya se guardó (se sigue usando "el más reciente", como antes); esto
 * solo añade la pregunta que faltaba. Un único mensaje para hasta 3
 * contradicciones del turno, mismo estilo que `preguntarPorHuecos` de B3.
 */
async function preguntarPorContradiccion(contradicciones: Contradiccion[], alaNube: boolean): Promise<void> {
  const lote = contradicciones.slice(0, 3);
  if (!lote.length) return;

  const detalle = lote.map(c =>
    `sobre ${c.entidadNombre}, tenía anotado que ${c.campo} era "${c.anterior}" y ahora parece que es "${c.nuevo}"`
  ).join('; ');

  const prompt = `Has detectado un posible cambio o contradicción en lo que sabes: ${detalle}. Pregunta al `
    + `señor, en un único mensaje breve y natural, si es un cambio real (algo que ha pasado) o si hubo un `
    + `malentendido — sin sonar a interrogatorio, con la curiosidad de quien quiere tener sus notas al día. `
    + `Trato de "señor". Nada de listas ni markdown.`;

  // Mismo criterio que `preguntarPorHuecos`: el contenido de la propia
  // contradicción manda sobre la decisión del turno si resulta sensible.
  const local = !alaNube || isSensitive(detalle);
  try {
    const texto = await askClaude(prompt, {
      maxTokens: 200, temperature: 0.5,
      ...(local ? { private: true } : { useCloud: true }),
    });
    const mensaje = texto.trim();
    if (!mensaje) { console.warn('🧠 Contradicción: el modelo devolvió una respuesta vacía, se descarta'); return; }
    const { sendSystemMessage } = await import('./telegram');
    await sendSystemMessage(`🧠 ${mensaje}`, mensaje);
  } catch (err) {
    console.warn('🧠 Contradicción: no se pudo redactar/enviar la pregunta:', (err as Error).message);
  }
}

/** B4.5 — caducidad: un dato de hace dos años no vale lo mismo que uno de ayer. */
function antiguedadAviso(fecha: Date): string {
  const dias = (Date.now() - new Date(fecha).getTime()) / 86_400_000;
  if (dias > 730) return ' [dato de hace más de 2 años, podría estar desactualizado]';
  if (dias > 365) return ' [dato de hace más de un año]';
  return '';
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
    if (!Array.isArray(ops)) { console.warn('🧠 Clasificador: la respuesta no es una lista'); return; }
    // Sin operaciones el turno NO termina aquí: la curiosidad por menciones (06/10)
    // depende de nombrar a alguien conocido, y "¿quién es Yaimy?" casi nunca propone
    // nada nuevo. Se registra a propósito: "no había nada que guardar" y "el modelo
    // no supo clasificarlo" deben verse distintos desde fuera.
    if (!ops.length) console.log('🧠 Clasificador: nada que guardar en este turno');
    else console.log(`🧠 Clasificador: ${ops.length} operación(es) propuesta(s)`);

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
    const contradiccionesTurno: Contradiccion[] = []; // B4.4

    // Dos pasadas, no una: nada en el prompt garantiza que el clasificador
    // devuelva "persona" antes que "relacion" en el mismo turno, y
    // `resolverEntidad` solo encuentra entidades ya guardadas — si "relacion"
    // se procesara primero, una persona creada EN ESTE MISMO turno aún no
    // existiría en Mongo y la relación se descartaría en silencio.
    const opsRelacion = ops.filter(op => op.caja === 'relacion');
    const opsResto     = ops.filter(op => op.caja !== 'relacion');

    for (const op of opsResto) {
      try {
        if (op.caja === 'persona') {
          const resultado = await aplicarPersona(op, origen, conversacion);
          if (resultado) {
            console.log(`🧠 ${resultado.log}`);
            contradiccionesTurno.push(...resultado.contradicciones);
            if (!candidatoId || (resultado.creado && !candidatoCreado)) {
              candidatoId     = resultado.persona._id;
              candidatoCreado = resultado.creado;
            }
          }
        } else if (op.caja === 'conocimiento') {
          const resultado = await aplicarConocimiento(op, origen);
          if (resultado) {
            console.log(`🧠 ${resultado.log}`);
            contradiccionesTurno.push(...resultado.contradicciones);
          }
        } else if (op.caja === 'recuerdo' || op.contenido) { // sin caja reconocida → recuerdo
          const resultado = await aplicarRecuerdo(op, sensible);
          if (resultado) console.log(`🧠 ${resultado}`);
        }
      } catch (err) {
        console.warn(`🧠 Clasificador: falló una operación (${op.caja}):`, (err as Error).message);
      }
    }
    for (const op of opsRelacion) { // B4.1 — después de crear/actualizar personas y conocimiento
      try {
        const resultado = await aplicarRelacion(op, origen, conversacion);
        if (resultado) console.log(`🧠 ${resultado}`);
      } catch (err) {
        console.warn('🧠 Clasificador: falló una operación (relacion):', (err as Error).message);
      }
    }

    // Nunca sobre un turno sensible: ni la pregunta se redacta ni el mensaje
    // sale — invariante §3.3, igual que el resto de este clasificador.
    if (!sensible) {
      // B4.4 tiene prioridad sobre B3: aclarar una posible contradicción importa
      // más que completar un hueco, y "una pregunta por turno" sigue aplicando
      // — nunca las dos cosas en el mismo mensaje.
      if (contradiccionesTurno.length) {
        await preguntarPorContradiccion(contradiccionesTurno, alaNube);
      }
      if (candidatoId) {
        const persona = await Person.findById(candidatoId);
        if (persona) {
          if (!contradiccionesTurno.length) await preguntarPorHuecos(persona, alaNube);
          // B4.2: deducir sobre la misma persona que ya centra la curiosidad de
          // este turno — mismo alcance acotado a propósito que B3.
          await deducirConexiones({ tipo: 'persona', id: persona._id, nombre: persona.nombre }, conversacion, alaNube);
        }
      } else if (!contradiccionesTurno.length) {
        // Curiosidad en menciones (06/10): una persona conocida nombrada en el mensaje
        // con huecos abiertos. Como mucho una pregunta por turno, igual que B3.
        const mencionada = await personaMencionadaConHuecos(userMessage);
        if (mencionada) await preguntarPorHuecos(mencionada, alaNube, 'mencion');
      }
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
  const [personas, conocimiento, recuerdos, relaciones] = await Promise.all([
    Person.find({ activo: true, $or: [{ nombre: rx }, { alias: rx }, { descripcion: rx }, { notas: rx }] }).limit(5),
    KnowledgeEntry.find({ activo: true, $or: [{ clave: rx }, { valor: rx }, { detalles: rx }] }).limit(5),
    searchMemories(t, { privado }).then(r => r.slice(0, 5)).catch(() => []),
    // B4: el grafo tipado, buscado por nombre de cualquiera de los dos extremos.
    // `sort` por `updatedAt` es imprescindible para B5.2 (recuperación híbrida):
    // sin él, `.slice(0, 3)` de más abajo elegía vecinos en el orden que Mongo
    // devolviera de forma arbitraria, no los más recientes/reconfirmados.
    Relation.find({ activo: true, $or: [{ origenNombre: rx }, { destinoNombre: rx }] })
      .sort({ updatedAt: -1 }).limit(8),
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
    partes.push(`PERSONA ${p.nombre}: ${campos.join(' · ')}${antiguedadAviso(p.updatedAt)}`);
  }
  for (const k of conocimiento) {
    partes.push(`CONOCIMIENTO (${k.categoria}/${k.clave}): ${k.valor}${k.detalles?.length ? ' · ' + k.detalles.join('. ') : ''}${antiguedadAviso(k.updatedAt)}`);
  }
  // B5.2 — recuperación híbrida: los vecinos del grafo amplían la búsqueda más
  // allá de la similitud pura. Si "Ibon" tiene una relación con "BAKO", una
  // pregunta sobre Ibon también rastrea memorias sobre "BAKO" — no solo las que
  // lo mencionan literalmente o le son semánticamente parecidas. Acotado a los
  // 3 vecinos más recientes y 2 memorias por vecino para no disparar el coste.
  const vecinos = [...new Set(relaciones.flatMap(r => [r.origenNombre, r.destinoNombre]))]
    .filter(nombre => normalizar(nombre) !== normalizar(t))
    .slice(0, 3);
  const idsVistos = new Set(recuerdos.map((m: any) => String(m._id)));
  const recuerdosVecinos: IMemory[] = [];
  if (vecinos.length) {
    const extra = (await Promise.all(
      vecinos.map(v => searchMemories(v, { privado }).then(r => r.slice(0, 2)).catch(() => []))
    )).flat();
    for (const m of extra) {
      const id = String((m as any)._id);
      if (idsVistos.has(id)) continue;
      idsVistos.add(id);
      recuerdosVecinos.push(m);
    }
  }

  for (const m of [...recuerdos, ...recuerdosVecinos]) {
    const fecha = new Date(m.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    partes.push(`RECUERDO (${fecha}): ${m.content}`);
  }
  // B4.3: lo dicho se presenta como hecho; lo deducido, siempre con la etiqueta
  // de confianza y la explicación — nunca igualado a un hecho confirmado.
  for (const r of relaciones) {
    const aviso = antiguedadAviso(r.updatedAt);
    if (r.dicha) {
      partes.push(`RELACIÓN: ${r.origenNombre} — ${r.relacion} — ${r.destinoNombre}.${aviso}`);
    } else {
      partes.push(
        `POSIBLE CONEXIÓN (deducción de BAKO, no confirmada, confianza ${confianzaLabel(r.confianza)}): `
        + `${r.origenNombre} podría estar relacionado con ${r.destinoNombre} vía "${r.relacion}"`
        + `${r.explicacion ? ` — ${r.explicacion}` : ''}.${aviso}`
      );
    }
  }

  if (!partes.length) return `No tengo nada guardado sobre "${t}", señor.`;
  return partes.join('\n');
}

// ─── Olvidar ─────────────────────────────────────────────────────────────────

/**
 * B4: "olvidar" una Persona o Conocimiento debe apagar también las relaciones
 * del grafo que la mencionan — si no, `consultarCerebro` seguiría enseñando
 * "RELACIÓN: Ibon — trabaja en — X" después de que el señor pidiera olvidar a
 * Ibon, contradiciendo directamente lo que acaba de pedir.
 */
async function apagarRelacionesDe(tipo: RelationEntityType, id: any): Promise<void> {
  await Relation.updateMany(
    { activo: true, $or: [{ origenTipo: tipo, origenId: id }, { destinoTipo: tipo, destinoId: id }] },
    { $set: { activo: false } }
  );
}

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

  const candidatas = await personasPorNombre(t, { activo: true });
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
  await apagarRelacionesDe('persona', existente._id);
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
  await apagarRelacionesDe('conocimiento', existente._id);
  return `📚 Conocimiento olvidado: ${existente.categoria}/${existente.clave}. Sigue en la base de datos por si hace falta recuperarlo, pero BAKO no lo usará.`;
}
