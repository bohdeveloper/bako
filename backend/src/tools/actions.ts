/**
 * Motor de ejecución de BAKO — Gap 2.
 * Detecta intenciones de escritura en lenguaje natural y las ejecuta.
 *
 * Intenciones soportadas:
 *  - Crear tarea en Notion
 *  - Actualizar estado de tarea en Notion
 *  - Crear evento en Google Calendar
 */

import { createNotionTask, updateNotionTaskStatus, findNotionTaskByName } from './notion';
import { createCalendarEvent } from './calendar';
import { createGitHubIssue } from './github';
import { markTrackerRecord } from './cloudflare';
import { askClaude } from '../llm/claude';
import { invalidateCalendarCache } from './context';
import { nowInSpain } from './cloudflare';

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

// ─── NOTION: Crear tarea ─────────────────────────────────────────────────────

async function executeCreateNotionTask(text: string): Promise<string> {
  const raw = await askClaude(text, {
    systemPrompt: `Extrae los datos de esta petición de creación de tarea en Notion.
Fecha y hora actual: ${fechaContexto()}

Responde SOLO con JSON válido (sin texto adicional):
{"nombre":"...","prioridad":"Alta|Media|Baja","proyecto":"nombre o null","fechaLimite":"YYYY-MM-DD o null"}

Para fechas relativas (mañana, el viernes, la próxima semana) usa la fecha actual como referencia.`,
    maxTokens: 150,
    useCloud:  true,
  });

  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('No pude interpretar los datos de la tarea.');

  const p = JSON.parse(match[0]);
  if (!p.nombre) throw new Error('No se especificó nombre para la tarea.');

  const task = await createNotionTask(p.nombre, {
    prioridad:   p.prioridad   !== 'null' ? p.prioridad   : undefined,
    proyecto:    p.proyecto    !== 'null' ? p.proyecto    : undefined,
    fechaLimite: p.fechaLimite !== 'null' ? p.fechaLimite : undefined,
  });

  const lines = [`✅ Tarea creada en Notion: *${task.nombre}*`];
  if (task.prioridad)   lines.push(`📌 Prioridad: ${task.prioridad}`);
  if (task.proyecto)    lines.push(`📂 Proyecto: ${task.proyecto}`);
  if (task.fechaLimite) lines.push(`📅 Fecha límite: ${task.fechaLimite}`);
  return lines.join('\n');
}

// ─── NOTION: Actualizar estado ───────────────────────────────────────────────

async function executeUpdateNotionTask(text: string): Promise<string> {
  const raw = await askClaude(text, {
    systemPrompt: `Extrae los datos de esta petición de actualización de estado de tarea en Notion.

Responde SOLO con JSON válido:
{"nombreTarea":"nombre aproximado de la tarea","nuevoEstado":"Completada|En progreso|Pendiente"}`,
    maxTokens: 100,
    useCloud:  true,
  });

  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('No pude interpretar la tarea a actualizar.');

  const p = JSON.parse(match[0]);
  const task = await findNotionTaskByName(p.nombreTarea);
  if (!task) return `⚠️ No encontré ninguna tarea con ese nombre en Notion.\n_Intenta con: "qué tareas tengo" para ver la lista exacta._`;

  await updateNotionTaskStatus(task.id, p.nuevoEstado);
  const icon = p.nuevoEstado === 'Completada' ? '✅' : p.nuevoEstado === 'En progreso' ? '🔄' : '⏳';
  return `${icon} Tarea *"${task.nombre}"* → *${p.nuevoEstado}* en Notion.`;
}

// ─── CALENDAR: Crear evento ──────────────────────────────────────────────────

async function executeCreateCalendarEvent(text: string): Promise<string> {
  const raw = await askClaude(text, {
    systemPrompt: `Extrae los datos de esta petición de creación de evento en Google Calendar.
Fecha y hora actual (España): ${fechaContexto()}

Responde SOLO con JSON válido:
{"titulo":"...","inicio":"YYYY-MM-DDTHH:MM:00","fin":"YYYY-MM-DDTHH:MM:00","descripcion":"... o null","ubicacion":"... o null"}

Si no se especifica duración, el evento dura 1 hora. Usa horario de España (Europe/Madrid).`,
    maxTokens: 200,
    useCloud:  true,
  });

  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('No pude interpretar los datos del evento.');

  const p = JSON.parse(match[0]);
  if (!p.titulo || !p.inicio || !p.fin) throw new Error('Faltan datos del evento (título, inicio o fin).');

  const event = await createCalendarEvent(p.titulo, p.inicio, p.fin, {
    descripcion: p.descripcion !== 'null' ? p.descripcion : undefined,
    ubicacion:   p.ubicacion   !== 'null' ? p.ubicacion   : undefined,
  });
  invalidateCalendarCache(); // fuerza recarga inmediata en el próximo mensaje

  const fechaStr = new Date(event.start).toLocaleString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });

  const lines = [`📅 Evento creado en Google Calendar: *${event.title}*`, `🕐 ${fechaStr}`];
  if (event.location)    lines.push(`📍 ${event.location}`);
  if (event.description) lines.push(`📝 ${event.description}`);
  return lines.join('\n');
}

// ─── GITHUB: Crear issue ─────────────────────────────────────────────────────

async function executeCreateGitHubIssue(text: string): Promise<string> {
  const repos = (process.env.GITHUB_USERNAME
    ? (process.env.PROACTIVITY_REPOS ?? 'diamadmin,unyona,ai-personal-os')
    : 'diamadmin,unyona,ai-personal-os'
  ).split(',').map(r => r.trim());

  const raw = await askClaude(text, {
    systemPrompt: `Extrae los datos de esta petición de creación de issue en GitHub.
Repositorios disponibles: ${repos.join(', ')}

Responde SOLO con JSON válido:
{"repo":"nombre exacto del repo","titulo":"...","descripcion":"... o null"}

Si el repo no se menciona explícitamente, elige el más probable según el contexto.`,
    maxTokens: 200,
    useCloud: true,
  });

  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('No pude interpretar los datos del issue.');

  const p = JSON.parse(match[0]);
  if (!p.repo || !p.titulo) throw new Error('Faltan datos del issue (repo o título).');

  const issue = await createGitHubIssue(p.repo, p.titulo, p.descripcion !== 'null' ? p.descripcion : undefined);

  return `🐛 Issue #${issue.number} creado en *${p.repo}*: "${issue.title}"\n🔗 ${issue.url}`;
}

// ─── TRACKER: Marcar actividad ───────────────────────────────────────────────

async function executeMarkTracker(text: string): Promise<string> {
  const raw = await askClaude(text, {
    systemPrompt: `Extrae los datos de esta petición de marcar una actividad del Tracker diario.
El Tracker registra actividades de la rutina diaria (Kronoshin, BIZIKI, meditación, gym, lectura, etc.).

Responde SOLO con JSON válido:
{"actividad":"nombre aproximado de la actividad","hecho":true|false,"motivo":"razón si no se hizo o null"}

Ejemplos de interpretación:
- "completé el Kronoshin" → {"actividad":"Kronoshin","hecho":true,"motivo":null}
- "no pude ir a BIZIKI porque llovía" → {"actividad":"BIZIKI","hecho":false,"motivo":"llovía"}
- "hice la meditación" → {"actividad":"meditación","hecho":true,"motivo":null}`,
    maxTokens: 150,
    useCloud: true,
  });

  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('No pude interpretar la actividad a registrar.');

  const p = JSON.parse(match[0]);
  if (!p.actividad) throw new Error('No se especificó qué actividad registrar.');

  const result = await markTrackerRecord(p.actividad, p.hecho, p.motivo ?? undefined);

  if (!result.success) return `⚠️ ${result.message}`;

  const icon = p.hecho ? '✅' : '❌';
  return `${icon} *${result.taskName}* registrada en el Tracker.${p.motivo ? `\n📝 Motivo: ${p.motivo}` : ''}`;
}

// ─── DETECTOR PRINCIPAL ──────────────────────────────────────────────────────

const NOTION_TASK_CREATE = /crea[r]?\s+(una?\s+)?tarea|añade?\s+(una?\s+)?tarea|nueva\s+tarea|agrega[r]?\s+(una?\s+)?tarea/i;

const CALENDAR_CREATE = /crea[r]?\s+(un[ao]?\s+)?evento|añade?\s+(un[ao]?\s+)?evento|nuevo\s+evento|agenda[r]?\s+(una?\s+)?(reuni[oó]n|cita|evento)|programa[r]?\s+(una?\s+)?(reuni[oó]n|cita)|bloquea[r]?\s+(tiempo|horas?)\s+en/i;

const GITHUB_ISSUE_CREATE = /crea[r]?\s+(un[ao]?\s+)?issue|abre?\s+(un[ao]?\s+)?issue|nuevo\s+issue|reporta[r]?\s+(un[ao]?\s+)?(bug|error|problema|issue)/i;

// Marcar actividad del Tracker: "completé X", "hice X", "no pude hacer X", "X no completada"
const TRACKER_MARK = /(?:complet[eé]|hice|he?\s+hecho|hiciste?\s+el|ya\s+hice?|ya\s+complet[eé]|registra[r]?\s+que|marca[r]?\s+como|no\s+(?:pude?|hice?|fui?)\s+(?:a\s+)?|no\s+(?:he?\s+)?(?:hecho|completado))\s+.+/i;

const NOTION_TASK_UPDATE = /marca[r]?\s+.+\s+(?:como\s+)?(?:completada?|hecha?|lista?|done|terminada?|en\s+progreso|empezada?)/i;
const TRACKER_KEYWORDS   = /tracker|kronoshin|biziki|meditaci[oó]n|gym|shaolin|rutina\s+del\s+d[ií]a/i;

export interface ExecutionResult {
  text:  string;
  voice: string;
}

export async function tryExecuteAction(userText: string): Promise<ExecutionResult | null> {
  try {
    if (NOTION_TASK_CREATE.test(userText)) {
      const text = await executeCreateNotionTask(userText);
      return { text, voice: stripMarkdown(text) };
    }

    if (CALENDAR_CREATE.test(userText)) {
      const text = await executeCreateCalendarEvent(userText);
      return { text, voice: stripMarkdown(text) };
    }

    if (GITHUB_ISSUE_CREATE.test(userText)) {
      const text = await executeCreateGitHubIssue(userText);
      return { text, voice: stripMarkdown(text) };
    }

    // Tracker: marcar actividad (antes que Notion para evitar falsos positivos)
    if (TRACKER_MARK.test(userText) && TRACKER_KEYWORDS.test(userText)) {
      const text = await executeMarkTracker(userText);
      return { text, voice: stripMarkdown(text) };
    }

    if (NOTION_TASK_UPDATE.test(userText) && !TRACKER_KEYWORDS.test(userText)) {
      const text = await executeUpdateNotionTask(userText);
      return { text, voice: stripMarkdown(text) };
    }
  } catch (err) {
    return {
      text:  `❌ ${(err as Error).message}`,
      voice: `No pude ejecutar esa acción. ${(err as Error).message}`,
    };
  }

  return null;
}
