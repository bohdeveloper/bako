/**
 * Motor de ejecución de BAKO — B0 del plan (05/09/2026).
 *
 * Sustituye al detector de regex de `actions.ts`: el LLM recibe estas herramientas
 * junto con el prompt normal y decide, EN LA MISMA llamada, si conversa en texto o
 * ejecuta una acción — no hace falta una segunda llamada de extracción de JSON por
 * cada intención, ni un patrón nuevo por cada forma de pedir lo mismo.
 *
 * Acciones soportadas (las mismas 6 de antes, ahora como herramientas):
 *  - Crear/actualizar tarea en Notion
 *  - Crear evento en Google Calendar (destructiva: pide confirmación)
 *  - Crear/cerrar issue sincronizado (Notion + GitHub)
 *  - Actualizar siguiente acción de un proyecto
 */

import { askClaudeWithTools, AskClaudeOptions } from '../llm/claude';
import { createNotionTask, updateNotionTaskStatus, findNotionTaskByName, updateNotionProjectSiguienteAccion, normalizeEstadoTarea } from './notion';
import { createCalendarEvent } from './calendar';
import { createIssueSync, closeIssueSync } from './issueSync';
import { invalidateCalendarCache } from './context';
import { nowInSpain } from './time';

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

// ─── Registro de herramientas ─────────────────────────────────────────────────

interface ToolDef {
  name:        string;
  description: string;
  parameters:  Record<string, any>; // JSON Schema
  destructive: boolean;             // true → pide confirmación explícita antes de ejecutar
  run:         (args: any) => Promise<string>;
}

const TOOLS: ToolDef[] = [
  {
    name:        'crear_tarea_notion',
    description: 'Crea una tarea nueva en Notion (Centro de Mando). Úsala cuando el señor pida crear, añadir o apuntar una tarea.',
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
      const lines = [`✅ Tarea creada en Notion: *${task.nombre}*`];
      if (task.prioridad)   lines.push(`📌 Prioridad: ${task.prioridad}`);
      if (task.proyecto)    lines.push(`📂 Proyecto: ${task.proyecto}`);
      if (task.fechaLimite) lines.push(`📅 Fecha objetivo: ${task.fechaLimite}`);
      return lines.join('\n');
    },
  },
  {
    name:        'actualizar_estado_tarea_notion',
    description: 'Cambia el estado de una tarea existente en Notion (marcarla como hecha, en curso, bloqueada o por hacer).',
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
      return `${icon} Tarea *"${task.nombre}"* → *${estado}* en Notion.`;
    },
  },
  {
    name:        'crear_evento_calendario',
    description: 'Crea un evento nuevo en Google Calendar. Úsala cuando el señor pida agendar, apuntar o programar una reunión, cita o evento con fecha y hora.',
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
      const lines = [`📅 Evento creado en Google Calendar: *${event.title}*`, `🕐 ${fechaStr}`];
      if (event.location)    lines.push(`📍 ${event.location}`);
      if (event.description) lines.push(`📝 ${event.description}`);
      return lines.join('\n');
    },
  },
  {
    name:        'crear_issue_sincronizado',
    description: 'Crea un issue sincronizado en Notion y GitHub para un proyecto. Úsala cuando el señor pida crear/abrir un issue o reportar un bug.',
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
      const lines = [`✅ Issue creado en *${proyecto}*: *${args.titulo}*`];
      if (result.ghNumber) lines.push(`🐙 GitHub #${result.ghNumber}: ${result.ghUrl}`);
      else lines.push('⚠️ GitHub: no se pudo crear (token sin permisos o repo no encontrado)');
      lines.push(`📋 Notion: ${result.notionId ? 'creado' : 'error al crear'}`);
      return lines.join('\n');
    },
  },
  {
    name:        'cerrar_issue_sincronizado',
    description: 'Cierra o completa un issue existente en Notion y GitHub. Úsala cuando el señor diga que un issue está completado o hay que cerrarlo.',
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
      return `✅ Issue *"${args.titulo}"* cerrado:\n${parts.join('\n')}`;
    },
  },
  {
    name:        'actualizar_siguiente_accion_proyecto',
    description: 'Actualiza el campo "siguiente acción" de un proyecto en Notion.',
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
      if (!ok) return `⚠️ No encontré el proyecto *${args.proyecto}* en Notion.`;
      return `✅ Siguiente acción de *${args.proyecto}* actualizada:\n_"${args.siguienteAccion}"_`;
    },
  },
];

// Esquema que espera la API (formato OpenAI, el mismo que aceptan Groq y Ollama)
const TOOL_SCHEMAS = TOOLS.map(t => ({
  type:     'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

const TOOL_INSTRUCTIONS = `Tienes herramientas para actuar de verdad sobre Notion y Google Calendar
(crear tareas, cambiar su estado, crear eventos, gestionar issues, actualizar el siguiente paso de un
proyecto). Úsalas SOLO cuando el señor pida explícitamente crear, actualizar, agendar o cerrar algo —
nunca para responder preguntas, dar información o conversar con normalidad. Si falta un dato
imprescindible para una herramienta, pregúntalo en texto en vez de inventarlo o de rellenarlo con un
valor de ejemplo.`;

// ─── Confirmación de acciones destructivas ────────────────────────────────────
// Mismo criterio que ya se usaba para enviar un email por Telegram, extendido a
// cualquier herramienta marcada `destructive`. En memoria, no en Mongo — un
// reinicio del proceso simplemente descarta confirmaciones pendientes, lo cual
// es lo seguro (nunca ejecutar algo que el señor no llegó a confirmar).
interface PendingAction { toolName: string; args: Record<string, any>; ts: number; }
const pendingActions = new Map<string, PendingAction>();
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 min para confirmar, luego caduca

const CONFIRM_YES = /^(s[ií]|confirmo|adelante|hazlo|correcto|ok|vale|proced[e]?)\b/i;
const CONFIRM_NO  = /^(no|cancela(r)?|olv[ií]dalo|mejor no)\b/i;

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
    const trimmed = userText.trim();
    if (CONFIRM_YES.test(trimmed)) {
      pendingActions.delete(confirmKey);
      const tool = TOOLS.find(t => t.name === pending.toolName);
      if (tool) {
        try {
          const text = await tool.run(pending.args);
          return { text, voice: stripMarkdown(text), toolUsed: tool.name };
        } catch (err) {
          const text = `❌ ${(err as Error).message}`;
          return { text, voice: `No pude completar la acción. ${(err as Error).message}` };
        }
      }
    }
    if (CONFIRM_NO.test(trimmed)) {
      pendingActions.delete(confirmKey);
      return { text: '❌ Acción cancelada.', voice: 'Acción cancelada, señor.' };
    }
    // Ni sí ni no reconocibles → se descarta lo pendiente y se sigue como mensaje normal
    pendingActions.delete(confirmKey);
  }

  // ── Llamada única: el modelo decide si conversa o llama a una herramienta ──
  const systemPrompt = `${options.systemPrompt ?? ''}\n\n${TOOL_INSTRUCTIONS}\nFecha y hora actual: ${fechaContexto()}`;
  const result = await askClaudeWithTools(userText, TOOL_SCHEMAS, { ...options, systemPrompt });

  if (!result.toolCall) {
    const text = result.text || 'Sin respuesta';
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
  const requiresConfirmation = tool.destructive || result.provider === 'ollama';
  if (requiresConfirmation) {
    pendingActions.set(confirmKey, { toolName: tool.name, args: result.toolCall.arguments, ts: Date.now() });
    const resumen = describeArgs(result.toolCall.arguments);
    const text = `⚠️ Voy a *${tool.description.split('.')[0].toLowerCase()}* — ${resumen}. ¿Confirma, señor? (sí/no)`;
    return { text, voice: `¿Confirma que quiere que haga esto? ${resumen}` };
  }

  try {
    const text = await tool.run(result.toolCall.arguments);
    return { text, voice: stripMarkdown(text), toolUsed: tool.name };
  } catch (err) {
    const text = `❌ ${(err as Error).message}`;
    return { text, voice: `No pude ejecutar esa acción. ${(err as Error).message}` };
  }
}
