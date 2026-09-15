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

import { Person } from '../memory/Person';
import { KnowledgeEntry, KnowledgeCategory } from '../memory/KnowledgeEntry';
import { askClaude } from '../llm/claude';
import { deduplicateAndSave, searchMemories } from './memory';
import { isSensitive } from './privacy';

const CATEGORIAS: KnowledgeCategory[] = [
  'salud', 'valores', 'caracter', 'finanzas', 'historia', 'rutina', 'objetivos', 'legal', 'hobbies', 'otro',
];
const RELACIONES = ['pareja', 'familiar', 'amigo', 'compañero', 'conocido', 'otro'];

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
BAKO sobre sí mismo (qué modelo usa, dónde se ejecuta). Tampoco nombre, edad, ciudad habitual,
empleador o rutina laboral de Borja — viven en su perfil base y se actualizan por su propio cauce
("ya no trabajo en X", "me he mudado a Y"), no como conocimiento nuevo.

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

async function aplicarPersona(op: Operacion, origen: string, conversacion: string): Promise<string | null> {
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
  const target    = normalizar(nombre);
  const candidatas = await Person.find();
  const existente  = candidatas.find(p =>
    normalizar(p.nombre) === target || p.alias.some(a => normalizar(a) === target)
  );

  const campos = soloConValor({
    relacion:    RELACIONES.includes(String(op.relacion)) ? op.relacion : undefined,
    descripcion: op.descripcion,
    cumpleaños:  /^\d{2}-\d{2}$/.test(String(op.cumpleaños ?? '')) ? op.cumpleaños : undefined,
    ubicacion:   op.ubicacion,
    trabajo:     op.trabajo,
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
    return `👤 Persona actualizada: ${nombre} (${Object.keys(campos).join(', ') || 'notas'})${oculta}`;
  }

  await Person.create({
    nombre,
    ...campos,
    notas:      op.notas ?? [],
    conexiones: op.conexiones ?? [],
    fuente:     'conversacion',
    origen,
  });
  return `👤 Persona creada: ${nombre}`;
}

async function aplicarConocimiento(op: Operacion, origen: string): Promise<string | null> {
  const clave = op.clave?.trim();
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
  // vez de actualizar el original.
  const existente = await KnowledgeEntry.findOne({ categoria, clave });
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
  forzarProveedor?: boolean, // solo para pruebas; en producción decide la regla de privacidad
): Promise<void> {
  try {
    // Clasificar es una tarea de razonamiento estructurado que el modelo local
    // no aguanta: medido el 06/09/2026 con "he conocido a X, amigo de Julen que
    // vive en Hernani y es profesor", qwen3:8b devolvió [] y Groq creó la ficha
    // completa, incluida la conexión con Julen. Así que se clasifica en la nube
    // —salvo que el turno toque contenido sensible, que por el invariante §3.3
    // no sale de local aunque eso signifique aprender menos de él.
    const sensible = isSensitive(`${userMessage}\n${assistantResponse}`);
    const alaNube  = forzarProveedor ?? !sensible;
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
    for (const op of ops) {
      try {
        let resultado: string | null = null;
        if      (op.caja === 'persona')      resultado = await aplicarPersona(op, origen, conversacion);
        else if (op.caja === 'conocimiento') resultado = await aplicarConocimiento(op, origen);
        else if (op.caja === 'recuerdo')     resultado = await aplicarRecuerdo(op, sensible);
        else if (op.contenido)               resultado = await aplicarRecuerdo(op, sensible); // sin caja → recuerdo
        if (resultado) console.log(`🧠 ${resultado}`);
      } catch (err) {
        console.warn(`🧠 Clasificador: falló una operación (${op.caja}):`, (err as Error).message);
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
  const escapado = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escapado, 'i');

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
