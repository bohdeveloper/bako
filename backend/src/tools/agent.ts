/**
 * Motor de ejecución de BAKO — B0 del plan (05/09/2026).
 *
 * Sustituye al detector de regex de `actions.ts`: el LLM recibe estas herramientas
 * junto con el prompt normal y decide, EN LA MISMA llamada, si conversa en texto o
 * ejecuta una acción — no hace falta una segunda llamada de extracción de JSON por
 * cada intención, ni un patrón nuevo por cada forma de pedir lo mismo.
 *
 * Herramientas registradas:
 *  - Crear/actualizar tarea en Notion
 *  - Crear evento en Google Calendar (destructiva: pide confirmación)
 *  - Crear/cerrar issue sincronizado (Notion + GitHub)
 *  - Actualizar siguiente acción de un proyecto
 *  - Consultar el cerebro (solo lectura, añadida en B1)
 *  - Olvidar una persona o un conocimiento (destructivas, añadidas en B2)
 */

import { askClaude, askClaudeWithTools, describeRuntime, isOllamaAvailableCached, AskClaudeOptions } from '../llm/claude';
import { createNotionTask, updateNotionTaskStatus, findNotionTaskByName, updateNotionProjectSiguienteAccion, normalizeEstadoTarea } from './notion';
import { createCalendarEvent } from './calendar';
import { createIssueSync, closeIssueSync } from './issueSync';
import { invalidateCalendarCache } from './context';
import { consultarCerebro, olvidarPersona, olvidarConocimiento, curiosidadParaTurno, marcarHuecoPreguntado, respuestaPreguntaPor } from './brain';
import { isSensitive } from './privacy';
import { nowInSpain } from './time';
import { BAKO_PROFILE } from '../knowledge/profile';

function fechaContexto(): string {
  return nowInSpain().toLocaleString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });
}

function stripMarkdown(text: string): string {
  return text.replace(/\*|_/g, '');
}

// Prompt mínimo para la redacción de abajo — a propósito NO es `options.systemPrompt`
// (~16k chars con memorias, personas, proyectos y tareas): esa carga tiene sentido
// cuando el modelo tiene que decidir qué hacer, pero aquí solo tiene que convertir
// un dato ya resuelto en una frase. Duplicarla habría doblado tokens/latencia en
// cada `consultar_cerebro` sin ganar nada — hallazgo de /code-review 16/09/2026.
const REDACCION_SYSTEM_PROMPT = `Eres BAKO, mayordomo personal. ${Object.values(BAKO_PROFILE.instrucciones_para_bako).join(' ')}`;

/**
 * Pendiente cerrado (16/09/2026): una herramienta de solo lectura devolvía su
 * volcado de datos tal cual como respuesta hablada — `consultar_cerebro` hacía
 * que BAKO recitara "PERSONA Ibon: relación: amigo · vive en Bilbao" en vez de
 * contestar como un mayordomo. Una segunda pasada, con el mismo proveedor y el
 * mismo gate de privacidad que ya decidió la llamada de arriba (`options.private`
 * / `options.useCloud` vienen ya calculados por el llamador), redacta la
 * respuesta a partir del dato crudo, sin poder inventar nada que no esté en él.
 */
async function redactarRespuestaLectura(pregunta: string, datosCrudos: string, options: AskClaudeOptions): Promise<string> {
  const prompt = `El señor preguntó: "${pregunta}"\n\n`
    + `Esto es lo que consta tal cual en tu memoria (puede estar vacío o decir que no hay nada):\n${datosCrudos}\n\n`
    + `Respóndele como mayordomo, en un párrafo breve y natural, usando SOLO estos datos — no inventes ni añadas `
    + `nada que no esté aquí. Si algo aparece como "POSIBLE CONEXIÓN" o "no confirmada", transmítelo como una `
    + `deducción tuya (p. ej. "podría ser que...", "no lo confirmaste, pero..."), nunca como un hecho comprobado. `
    + `Si no hay nada relevante, dilo con naturalidad, sin recitar el aviso de arriba.`;
  try {
    return await askClaude(prompt, {
      systemPrompt: REDACCION_SYSTEM_PROMPT,
      useCloud:     options.useCloud,
      private:      options.private,
      temperature:  options.temperature,
      maxTokens:    300,
    });
  } catch {
    // Si la redacción falla (p. ej. Ollama se cae justo entre las dos llamadas de
    // un turno privado), se devuelve el volcado crudo tal cual: es un degradado
    // de estilo, no de privacidad — `askClaude` con `private:true` solo intenta
    // Ollama y nunca ha tocado la nube en este punto, así que lo peor que pasa
    // aquí es que la respuesta suene menos a mayordomo, no que algo se filtre.
    return datosCrudos;
  }
}

// Los nombres de tarea/proyecto/issue vienen de extracción libre del LLM o de lo
// que dicte el señor, y acaban interpolados dentro de un mensaje que Telegram
// parsea como Markdown: un `_` suelto en "revisar_informe" rompe el envío entero
// y el señor ve un error genérico aunque la acción sí se haya ejecutado.
function md(valor: unknown): string {
  return String(valor ?? '').replace(/[_*[\]`]/g, '');
}

// ─── Registro de herramientas ─────────────────────────────────────────────────

interface ToolDef {
  name:        string;
  description: string;              // para el LLM: cuándo usarla
  label:       string;              // para el señor: cómo se lee en la confirmación ("Voy a <label>")
  parameters:  Record<string, any>; // JSON Schema
  destructive: boolean;             // true → pide confirmación explícita antes de ejecutar
  soloLectura?: boolean;            // no escribe nada → nunca pide confirmación, ni con el modelo local
  run:         (args: any) => Promise<string>;
}

const TOOLS: ToolDef[] = [
  {
    name:        'crear_tarea_notion',
    description: 'Crea una tarea nueva en Notion (Centro de Mando). Úsala cuando el señor pida crear, añadir o apuntar una tarea.',
    label:       'crear una tarea en Notion',
    parameters: {
      type: 'object',
      properties: {
        nombre:      { type: 'string', description: 'Nombre de la tarea' },
        prioridad:   { type: 'string', enum: ['Alta', 'Media', 'Baja'], description: 'Prioridad, si se menciona' },
        proyecto:    { type: 'string', description: 'Nombre del proyecto asociado, si se menciona' },
        fechaLimite: { type: 'string', description: 'Fecha objetivo en formato YYYY-MM-DD, si se menciona (interpreta fechas relativas contra la fecha actual)' },
      },
      required: ['nombre'],
    },
    destructive: false,
    run: async (args) => {
      const task = await createNotionTask(args.nombre, {
        prioridad:   args.prioridad,
        proyecto:    args.proyecto,
        fechaLimite: args.fechaLimite,
      });
      const lines = [`✅ Tarea creada en Notion: *${md(task.nombre)}*`];
      if (task.prioridad)   lines.push(`📌 Prioridad: ${md(task.prioridad)}`);
      if (task.proyecto)    lines.push(`📂 Proyecto: ${md(task.proyecto)}`);
      if (task.fechaLimite) lines.push(`📅 Fecha objetivo: ${md(task.fechaLimite)}`);
      return lines.join('\n');
    },
  },
  {
    name:        'actualizar_estado_tarea_notion',
    description: 'Cambia el estado de una tarea existente en Notion (marcarla como hecha, en curso, bloqueada o por hacer).',
    label:       'cambiar el estado de una tarea en Notion',
    parameters: {
      type: 'object',
      properties: {
        nombreTarea: { type: 'string', description: 'Nombre aproximado de la tarea a actualizar' },
        nuevoEstado: { type: 'string', enum: ['Hecho', 'En curso', 'Bloqueado', 'Por hacer'] },
      },
      required: ['nombreTarea', 'nuevoEstado'],
    },
    destructive: false,
    run: async (args) => {
      const task = await findNotionTaskByName(args.nombreTarea);
      if (!task) return `⚠️ No encontré ninguna tarea con ese nombre en Notion.\n_Intenta con: "qué tareas tengo" para ver la lista exacta._`;
      const estado = normalizeEstadoTarea(args.nuevoEstado);
      await updateNotionTaskStatus(task.id, estado);
      const icon = estado === 'Hecho' ? '✅' : estado === 'En curso' ? '🔄' : estado === 'Bloqueado' ? '🚧' : '⏳';
      return `${icon} Tarea *"${md(task.nombre)}"* → *${md(estado)}* en Notion.`;
    },
  },
  {
    name:        'crear_evento_calendario',
    description: 'Crea un evento nuevo en Google Calendar. Úsala cuando el señor pida agendar, apuntar o programar una reunión, cita o evento con fecha y hora.',
    label:       'crear un evento en Google Calendar',
    parameters: {
      type: 'object',
      properties: {
        titulo:      { type: 'string' },
        inicio:      { type: 'string', description: 'Fecha y hora de inicio, formato YYYY-MM-DDTHH:MM:00, horario de España' },
        fin:         { type: 'string', description: 'Fecha y hora de fin, formato YYYY-MM-DDTHH:MM:00. Si no se especifica duración, 1 hora tras el inicio' },
        descripcion: { type: 'string' },
        ubicacion:   { type: 'string' },
      },
      required: ['titulo', 'inicio', 'fin'],
    },
    // Crea un compromiso real en el calendario (puede notificar a invitados si los
    // hubiera) — es la única de las 6 que pide confirmación explícita antes de
    // ejecutarse, siguiendo el mismo criterio que ya se aplicaba a enviar un email.
    destructive: true,
    run: async (args) => {
      const event = await createCalendarEvent(args.titulo, args.inicio, args.fin, {
        descripcion: args.descripcion,
        ubicacion:   args.ubicacion,
      });
      invalidateCalendarCache();
      const fechaStr = new Date(event.start).toLocaleString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Madrid',
      });
      const lines = [`📅 Evento creado en Google Calendar: *${md(event.title)}*`, `🕐 ${fechaStr}`];
      if (event.location)    lines.push(`📍 ${md(event.location)}`);
      if (event.description) lines.push(`📝 ${md(event.description)}`);
      return lines.join('\n');
    },
  },
  {
    name:        'crear_issue_sincronizado',
    description: 'Crea un issue sincronizado en Notion y GitHub para un proyecto. Úsala cuando el señor pida crear/abrir un issue o reportar un bug.',
    label:       'crear un issue en Notion y GitHub',
    parameters: {
      type: 'object',
      properties: {
        titulo:      { type: 'string' },
        proyecto:    { type: 'string', enum: ['BAKO', 'Unyona', 'Diamadmin'], description: 'Si no se menciona, usa BAKO' },
        prioridad:   { type: 'string', enum: ['Alta', 'Media', 'Baja'] },
        descripcion: { type: 'string' },
      },
      required: ['titulo'],
    },
    destructive: false,
    run: async (args) => {
      const proyecto = args.proyecto ?? 'BAKO';
      const result = await createIssueSync(args.titulo, proyecto, {
        priority: args.prioridad ?? 'Media',
        notes:    args.descripcion,
      });
      const lines = [`✅ Issue creado en *${md(proyecto)}*: *${md(args.titulo)}*`];
      if (result.ghNumber) lines.push(`🐙 GitHub #${result.ghNumber}: ${result.ghUrl}`);
      else lines.push('⚠️ GitHub: no se pudo crear (token sin permisos o repo no encontrado)');
      lines.push(`📋 Notion: ${result.notionId ? 'creado' : 'error al crear'}`);
      return lines.join('\n');
    },
  },
  {
    name:        'cerrar_issue_sincronizado',
    description: 'Cierra o completa un issue existente en Notion y GitHub. Úsala cuando el señor diga que un issue está completado o hay que cerrarlo.',
    label:       'cerrar un issue en Notion y GitHub',
    parameters: {
      type: 'object',
      properties: {
        titulo:   { type: 'string', description: 'Título o nombre aproximado del issue a cerrar' },
        proyecto: { type: 'string', enum: ['BAKO', 'Unyona', 'Diamadmin'] },
      },
      required: ['titulo'],
    },
    destructive: false,
    run: async (args) => {
      const result = await closeIssueSync(args.titulo, args.proyecto);
      const parts: string[] = [];
      if (result.notionClosed) parts.push('📋 Notion: marcado como Hecho');
      else parts.push('⚠️ Notion: issue no encontrado');
      if (result.ghClosed) parts.push(`🐙 GitHub (${result.repo}): cerrado`);
      else if (result.repo) parts.push(`⚠️ GitHub (${result.repo}): issue no encontrado`);
      return `✅ Issue *"${md(args.titulo)}"* cerrado:\n${parts.join('\n')}`;
    },
  },
  {
    name:        'consultar_cerebro',
    description: 'Consulta lo que BAKO tiene guardado sobre una persona, un tema o un asunto concreto (personas, conocimiento personal, recuerdos y sus conexiones con otras personas o proyectos, dichas o deducidas). Úsala cuando el señor pregunte "¿qué sabes de X?" o cuando necesites datos sobre alguien que no aparezcan ya en el contexto.',
    label:       'consultar lo que sé sobre eso',
    parameters: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Nombre de la persona o tema a buscar' },
      },
      required: ['tema'],
    },
    destructive: false,
    // Solo lectura: no pide confirmación ni siquiera con el modelo local, porque
    // en el peor caso devuelve una búsqueda que no venía a cuento.
    soloLectura: true,
    run: async (args) => consultarCerebro(String(args.tema ?? '')),
  },
  {
    name:        'olvidar_persona',
    description: 'Desactiva (olvida) una Persona guardada en el cerebro de BAKO. Úsala SOLO cuando el señor pida explícitamente olvidar o borrar la ficha de alguien concreto. Nunca la uses para conocimiento personal de Borja ni para recuerdos sueltos.',
    label:       'olvidar esa persona',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la persona a olvidar' },
      },
      required: ['nombre'],
    },
    destructive: true,
    run: async (args) => olvidarPersona(String(args.nombre ?? '')),
  },
  {
    name:        'olvidar_conocimiento',
    description: 'Desactiva (olvida) una entrada de conocimiento personal sobre Borja. Úsala SOLO cuando el señor pida explícitamente olvidar o borrar un dato conocido suyo. Nunca la uses para personas ni para recuerdos sueltos.',
    label:       'olvidar ese conocimiento',
    parameters: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Clave o tema del conocimiento a olvidar' },
      },
      required: ['tema'],
    },
    destructive: true,
    run: async (args) => olvidarConocimiento(String(args.tema ?? '')),
  },
  {
    name:        'actualizar_siguiente_accion_proyecto',
    description: 'Actualiza el campo "siguiente acción" de un proyecto en Notion.',
    label:       'actualizar la siguiente acción de un proyecto',
    parameters: {
      type: 'object',
      properties: {
        proyecto:        { type: 'string' },
        siguienteAccion: { type: 'string' },
      },
      required: ['proyecto', 'siguienteAccion'],
    },
    destructive: false,
    run: async (args) => {
      const ok = await updateNotionProjectSiguienteAccion(args.proyecto, args.siguienteAccion);
      if (!ok) return `⚠️ No encontré el proyecto *${md(args.proyecto)}* en Notion.`;
      return `✅ Siguiente acción de *${md(args.proyecto)}* actualizada:\n_"${md(args.siguienteAccion)}"_`;
    },
  },
];

// Esquema que espera la API (formato OpenAI, el mismo que aceptan Groq y Ollama)
const TOOL_SCHEMAS = TOOLS.map(t => ({
  type:     'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

// Dos familias de herramientas con reglas opuestas, y hay que decirlo explícito:
// las de acción solo se usan si el señor pide hacer algo, pero `consultar_cerebro`
// existe precisamente para responder preguntas. La versión anterior decía "nunca
// para responder preguntas, dar información o conversar" a secas, lo que dejaba a
// `consultar_cerebro` contradicha por su propia instrucción de sistema.
const TOOL_INSTRUCTIONS = `Tienes dos tipos de herramientas:

1) ACCIÓN sobre Notion y Google Calendar (crear tareas, cambiar su estado, crear eventos, gestionar
issues, actualizar el siguiente paso de un proyecto). Úsalas SOLO cuando el señor pida explícitamente
crear, actualizar, agendar o cerrar algo — nunca para conversar ni para dar información.

2) MEMORIA sobre tu propio conocimiento. \`consultar_cerebro\` sí es para responder: úsala cuando el
señor pregunte qué sabes de alguien o de algo, o cuando necesites un dato sobre una persona que no
esté ya en el contexto de arriba. \`olvidar_persona\` y \`olvidar_conocimiento\` solo si pide
explícitamente que olvides algo.

Si falta un dato imprescindible para una herramienta, pregúntalo en texto en vez de inventarlo o de
rellenarlo con un valor de ejemplo.`;

// ─── Confirmación de acciones destructivas ────────────────────────────────────
// Mismo criterio que ya se usaba para enviar un email por Telegram, extendido a
// cualquier herramienta marcada `destructive`. En memoria, no en Mongo — un
// reinicio del proceso simplemente descarta confirmaciones pendientes, lo cual
// es lo seguro (nunca ejecutar algo que el señor no llegó a confirmar).
interface PendingAction { toolName: string; args: Record<string, any>; ts: number; reasked?: boolean; }
const pendingActions = new Map<string, PendingAction>();
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 min para confirmar, luego caduca

// Normaliza el mensaje para compararlo con las frases de confirmación: quita
// acentos, signos, emojis y espacios de sobra. "Sí, hazlo!" → "si hazlo".
function normalizeConfirm(text: string): string {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita los acentos: "sí" → "si"
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')                        // fuera puntuación y emojis
    .replace(/\s+/g, ' ')
    .trim();
}

// Comparación por frase COMPLETA, no por prefijo, y sin `\b` — que en JavaScript
// no reconoce vocales acentuadas (invariante #14 de spec.md). La versión anterior
// con `/^(s[ií]|...|vale|ok)\b/` fallaba en las dos direcciones a la vez:
// rechazaba "sí" (con tilde, que es justo lo que se pide y lo que transcribe
// Whisper en las notas de voz) y en cambio ejecutaba la acción pendiente con
// cualquier frase que empezara por "Si mañana...", "ok pero..." o "Correcto,
// aunque...". Exigir la frase entera cierra las dos puertas.
const CONFIRM_YES = new Set([
  'si', 'claro', 'vale', 'ok', 'okay', 'de acuerdo', 'adelante', 'hazlo', 'confirmo',
  'confirmado', 'correcto', 'procede', 'dale', 'afirmativo', 'perfecto', 'eso es',
  'si por favor', 'si adelante', 'si hazlo', 'si confirmo', 'si claro', 'si gracias',
  'hazlo ya', 'venga', 'sip', 'por favor',
]);
const CONFIRM_NO = new Set([
  'no', 'no gracias', 'nope', 'dejalo', 'dejalo estar', 'olvidalo', 'cancela',
  'cancelalo', 'cancelar', 'mejor no', 'para', 'anula', 'anulalo', 'negativo',
  'nada', 'no hace falta', 'ni hablar', 'no por favor',
]);

// Segunda vía, para confirmaciones algo más habladas que no están en las listas
// ("sí, por favor créalo ya"). Se exige que sea corta, que empiece por una
// palabra de sí/no, que no lleve adversativa y que no sea una pregunta — así
// "Si puedes, dime qué tareas tengo" o "ok pero antes dime el tiempo" siguen
// SIN contar como confirmación.
const YES_TOKENS = new Set(['si', 'claro', 'vale', 'ok', 'okay', 'adelante', 'hazlo', 'confirmo', 'dale', 'venga', 'correcto', 'perfecto']);
const NO_TOKENS  = new Set(['no', 'cancela', 'cancelalo', 'olvidalo', 'dejalo', 'anula', 'anulalo', 'nada', 'negativo']);
const ADVERSATIVAS = /\b(pero|aunque|sin embargo|salvo|excepto)\b/;

export type ConfirmAnswer = 'si' | 'no' | null;

function interpretConfirmation(rawText: string): ConfirmAnswer {
  const t = normalizeConfirm(rawText);
  if (!t) return null;
  if (CONFIRM_YES.has(t)) return 'si';
  if (CONFIRM_NO.has(t))  return 'no';

  const palabras = t.split(' ');
  const esPregunta = rawText.includes('?') || /\b(que|cual|cuando|donde|como|quien|por que)\b/.test(t);
  if (palabras.length > 5 || esPregunta || ADVERSATIVAS.test(t)) return null;
  if (YES_TOKENS.has(palabras[0])) return 'si';
  if (NO_TOKENS.has(palabras[0]))  return 'no';
  return null;
}

// Los valores vienen de extracción libre del LLM (o de texto tecleado/dictado
// por el señor) — se les quita el markdown antes de interpolarlos en un mensaje
// que Telegram va a parsear como Markdown, para que un `*` o `_` suelto no
// rompa el envío entero de la confirmación.
function describeArgs(args: Record<string, any>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${stripMarkdown(String(v))}`)
    .join(', ');
}

// El JSON Schema declara `required`, pero nada obliga al LLM a respetarlo —
// medido con qwen3:8b, a veces no lo hace. Comprobarlo aquí evita pedir
// confirmación de una acción que luego fallaría con un error opaco de la API
// externa (o, peor, se ejecutaría con un campo vacío).
function missingRequiredFields(tool: ToolDef, args: Record<string, any>): string[] {
  const required: string[] = tool.parameters.required ?? [];
  return required.filter(key => args[key] === undefined || args[key] === null || args[key] === '');
}

export interface AgentTurnResult {
  text:      string;
  voice:     string;
  toolUsed?: string; // nombre de la herramienta ejecutada, si hubo una — para que el llamador decida si extraer memorias de este turno
  // Un turno con herramienta no enseñaba nada, y eso valía para `crear_tarea`
  // (donde el texto es un acuse de recibo, sin nada que aprender) pero no para
  // `consultar_cerebro`: preguntar "¿qué sabes de Ibon?" también es conversación
  // y el señor suele corregir o ampliar en la misma frase. Las de solo lectura
  // no escriben nada, así que su turno se aprende como cualquier otro.
  toolReadOnly?: boolean;
  awaitingConfirmation?: boolean; // el texto es una pregunta de confirmación: quien pueda (Telegram) que muestre botones
}

/** Ejecuta la acción que estaba pendiente de confirmación, si sigue viva. */
export async function confirmPendingAction(confirmKey: string): Promise<AgentTurnResult> {
  const pending = pendingActions.get(confirmKey);
  pendingActions.delete(confirmKey);
  if (!pending || Date.now() - pending.ts >= PENDING_TTL_MS) {
    return { text: '⚠️ Esa confirmación ya ha caducado, señor. Pídamelo otra vez.', voice: 'Esa confirmación ya ha caducado, señor. Pídamelo otra vez.' };
  }
  const tool = TOOLS.find(t => t.name === pending.toolName);
  if (!tool) return { text: '⚠️ Ya no reconozco esa acción.', voice: 'Ya no reconozco esa acción, señor.' };
  try {
    const text = await tool.run(pending.args);
    return { text, voice: stripMarkdown(text), toolUsed: tool.name };
  } catch (err) {
    const text = `❌ ${(err as Error).message}`;
    return { text, voice: `No pude completar la acción. ${(err as Error).message}` };
  }
}

/** Descarta la acción pendiente sin ejecutarla. */
export function cancelPendingAction(confirmKey: string): AgentTurnResult {
  pendingActions.delete(confirmKey);
  return { text: '❌ Acción cancelada.', voice: 'Acción cancelada, señor.' };
}

/**
 * Punto de entrada único: sustituye a la pareja "tryExecuteAction + askClaude"
 * de antes. `confirmKey` identifica la conversación para poder recordar una
 * acción destructiva pendiente de confirmación (p. ej. `telegram:${chatId}` o
 * `desktop:${userId}`).
 */
export async function runAgentTurn(
  userText: string,
  confirmKey: string,
  options: AskClaudeOptions = {}
): Promise<AgentTurnResult> {
  // ── ¿Es la respuesta a una confirmación pendiente? ──────────────────────────
  const pending = pendingActions.get(confirmKey);
  if (pending && Date.now() - pending.ts < PENDING_TTL_MS) {
    const respuesta = interpretConfirmation(userText);
    if (respuesta === 'si') return confirmPendingAction(confirmKey);
    if (respuesta === 'no') return cancelPendingAction(confirmKey);

    // Ni sí ni no. Se repregunta UNA sola vez, y solo si el mensaje es corto
    // (probable intento de confirmar con una fórmula rara). A la segunda, o si
    // el mensaje es largo, se descarta lo pendiente y sigue el flujo normal —
    // si no, un "hola" dejaría a BAKO repreguntando durante los 5 min del TTL.
    if (!pending.reasked && normalizeConfirm(userText).split(' ').length <= 4) {
      pending.reasked = true;
      const texto = 'No le he entendido, señor. ¿Confirmo la acción pendiente? Responda «sí» o «no».';
      return { text: texto, voice: texto, awaitingConfirmation: true };
    }
    pendingActions.delete(confirmKey);
  }

  // ── Llamada única: el modelo decide si conversa o llama a una herramienta ──
  // Qué proveedor va a responder DE VERDAD, no el que se pidió: en modo "auto"
  // se pide Ollama sin comprobar nada, y con el túnel caído responde Groq por el
  // fallback interno. Decirle al prompt lo contrario sería crear la misma
  // alucinación que este bloque viene a quitar.
  const enLaNube = (options.useCloud ?? false) || !(await isOllamaAvailableCached());
  const runtime = `EJECUCIÓN ACTUAL: ahora mismo te ejecuta ${describeRuntime(enLaNube)}. `
    + `Si el señor pregunta dónde te ejecutas, con qué modelo funcionas o si estás usando la GPU de su PC, `
    + `respóndele con este dato — nunca supongas que eres un modelo en la nube.`;
  // Curiosidad dentro del turno: nunca en un turno sensible (§3.3), y sin romper el
  // turno si falla la consulta
  const curiosidad = (options.private || isSensitive(userText))
    ? null
    : await curiosidadParaTurno(userText).catch(() => null);
  const systemPrompt = `${options.systemPrompt ?? ''}\n\n${TOOL_INSTRUCTIONS}\nFecha y hora actual: ${fechaContexto()}\n${runtime}`
    + (curiosidad ? `\n${curiosidad.instruccion}` : '');
  const result = await askClaudeWithTools(userText, TOOL_SCHEMAS, { ...options, systemPrompt });

  if (!result.toolCall) {
    const text = result.text || 'Sin respuesta';
    // Solo cuenta como preguntado si una frase interrogativa nombra a esa persona:
    // un "¿Quiere que se lo apunte?" no puede cerrar el hueco para siempre
    if (curiosidad && respuestaPreguntaPor(text, curiosidad.nombre)) {
      marcarHuecoPreguntado(curiosidad.personaId, curiosidad.campo).catch(() => {});
    }
    return { text, voice: stripMarkdown(text) };
  }

  const tool = TOOLS.find(t => t.name === result.toolCall!.name);
  if (!tool) {
    const text = result.text || 'No reconozco esa acción, señor.';
    return { text, voice: stripMarkdown(text) };
  }

  const faltan = missingRequiredFields(tool, result.toolCall.arguments);
  if (faltan.length) {
    const text = `⚠️ Me falta ${faltan.join(', ')} para poder hacerlo. ¿Me lo indica, señor?`;
    return { text, voice: text };
  }

  // El gate de confirmación se decide por quién respondió DE VERDAD
  // (`result.provider`), no por lo que se pidió (`options.useCloud`): si se
  // pidió Ollama pero estaba caído y respondió Groq por el fallback interno de
  // `askClaudeWithTools`, no tiene sentido aplicar la cautela pensada para el
  // modelo local. Esa cautela existe porque, probado el 05/09/2026, qwen3:8b
  // alucina llamadas a herramientas que no venían a cuento (pidiéndole un
  // chiste, creó una tarea real en Notion sin que nadie lo pidiera) mientras
  // que Groq (gpt-oss-120b) acertó las 4 pruebas sin un solo falso positivo.
  // Hasta que haya un modelo local más fiable para esto, mejor confirmar de
  // más que escribir basura en Notion/Calendar sin que el señor lo pidiera.
  const requiresConfirmation = tool.destructive || (result.provider === 'ollama' && !tool.soloLectura);
  if (requiresConfirmation) {
    pendingActions.set(confirmKey, { toolName: tool.name, args: result.toolCall.arguments, ts: Date.now() });
    const resumen = describeArgs(result.toolCall.arguments);
    return {
      text:  `⚠️ Voy a ${tool.label} — ${resumen}. ¿Confirma, señor? (sí/no)`,
      voice: `Voy a ${tool.label}. ${resumen}. ¿Lo confirma, señor?`,
      awaitingConfirmation: true,
    };
  }

  try {
    const rawText = await tool.run(result.toolCall.arguments);
    let text = rawText;
    if (tool.soloLectura) {
      // `options.private` es el gate sobre el MENSAJE del señor ("¿qué sabes de
      // Ibon?" no dispara isSensitive), pero `consultarCerebro` puede devolver
      // notas guardadas sobre esa persona que sí lo sean — brain.ts ya protege su
      // propia búsqueda semántica con este mismo criterio (`privado` en
      // consultarCerebro). Sin este OR, la redacción de abajo mandaría ese texto
      // a Groq aunque el propio dato ya se hubiera juzgado sensible antes de
      // llegar aquí. Hallazgo de /code-review 16/09/2026.
      const privado = options.private || isSensitive(rawText);
      text = await redactarRespuestaLectura(userText, rawText, { ...options, private: privado, useCloud: privado ? false : options.useCloud });
    }
    return { text, voice: stripMarkdown(text), toolUsed: tool.name, toolReadOnly: tool.soloLectura === true };
  } catch (err) {
    const text = `❌ ${(err as Error).message}`;
    return { text, voice: `No pude ejecutar esa acción. ${(err as Error).message}` };
  }
}


