import TelegramBot from 'node-telegram-bot-api';
import FormData from 'form-data';
import axios from 'axios';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { getWeather } from './weather';
import { fetchGitHubData } from './github';
import { getNotionTasks, createNotionTask } from './notion';
import { getCalendarEvents, formatEventsForSpeech } from './calendar';
import { getUnreadEmails, getEmailBody, createDraft, formatEmailsForSpeech, formatEmailsForText } from './gmail';
import { getTrackerSummary, formatTrackerForSpeech, markTrackerRecord, getBlogComments, formatCommentsForSpeech, nowInSpain } from './cloudflare';
import { askClaude, isOllamaAvailable, PrivacyError } from '../llm/claude';
import { generateVoiceBuffer, setVoice, getCurrentVoiceKey, VOCES_DISPONIBLES } from './tts';
import { BAKO_PROFILE } from '../knowledge/profile';
import { saveMemory, getMemories, searchMemories, formatMemoriesForPrompt, forgetMemory, extractAndSaveMemories, getCurrentLocation } from './memory';
import { buildDynamicProfileContext, updateProfileField, detectProfileUpdate, PROFILE_FIELDS } from './profileDynamic';
import { Rule } from '../memory/Rule';
import { tryExecuteAction } from './actions';
import { getAmbientContext, invalidateCityWeatherCache } from './context';

export function buildSystemPrompt(extraContext = '', memoriesSection = '', dynamicProfileSection = ''): string {
  const now   = nowInSpain();
  const hora  = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const fecha = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const diasSemana = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const diaSemana  = diasSemana[now.getDay()];

  // Deducir contexto situacional según hora y día
  const hora24 = now.getHours();
  const esFinDeSemana = now.getDay() === 0 || now.getDay() === 6;
  let situacion = '';
  if (!esFinDeSemana) {
    if (hora24 >= 5 && hora24 < 6)       situacion = 'Acaba de despertar. Rutina matutina: Kronoshin y preparación.';
    else if (hora24 >= 6 && hora24 < 7)  situacion = 'En camino al trabajo — bus Errentería → Donostia.';
    else if (hora24 >= 7 && hora24 < 14) situacion = 'Jornada laboral en Inetum, Donostia.';
    else if (hora24 >= 14 && hora24 < 15) situacion = 'Volviendo a casa — bus Donostia → Errentería.';
    else if (hora24 >= 15 && hora24 < 19) situacion = 'Tiempo personal en casa — ocio o proyectos propios.';
    else if (hora24 >= 19 && hora24 < 21) situacion = 'Entrenamiento: Biziki o técnica Shaolin en Arramendi.';
    else if (hora24 >= 21)               situacion = 'Noche — ducha, cena ligera y descanso.';
  } else {
    situacion = `Fin de semana — día libre. ${diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1)}.`;
  }

  const personalitySection = buildPersonalitySection(currentPersonality);

  return `Eres BAKO (Borja's Autonomous Knowledge Operator), mayordomo personal de tu señor.

════════════════════════════════════════
${personalitySection}
════════════════════════════════════════

REGLAS DE CONVERSACIÓN:
- Trato: siempre de "señor". Nunca usar el nombre directamente.
- Responde siempre en español.
- Longitud: ajusta al contexto — una pregunta simple merece una respuesta corta; algo complejo puede extenderse.
- Nunca inventes datos. Si no sabes algo, dilo sin rodeos.
- Si hay dos datos contradictorios en memoria, usa el más reciente sin mencionar el conflicto.
- Detecta si el señor usa ironía o humor: si es así, y tus parámetros lo permiten, entra al juego.

CONTEXTO ACTUAL:
- Fecha y hora: ${fecha} — ${hora} (hora de España, Europe/Madrid)
- Situación probable: ${situacion}
${extraContext}
${dynamicProfileSection ? `\n${dynamicProfileSection}\n` : ''}
${memoriesSection ? `RECUERDOS DINÁMICOS (lo que sabes sobre el señor — fuente de verdad):\n${memoriesSection}\n` : ''}
PERFIL BASE:
${JSON.stringify({
  identidad: BAKO_PROFILE.identidad,
  pareja: BAKO_PROFILE.pareja,
  proyectos: Object.fromEntries(
    Object.entries(BAKO_PROFILE.proyectos).map(([k, v]: [string, any]) => [k, { nombre: v.nombre, estado: v.estado, tipo: v.tipo }])
  ),
  vida_personal: {
    filosofia: BAKO_PROFILE.vida_personal.filosofia,
    rutina_diaria: BAKO_PROFILE.vida_personal.rutina_diaria,
    busqueda_vivienda: BAKO_PROFILE.vida_personal.busqueda_vivienda,
  },
  instrucciones_para_bako: BAKO_PROFILE.instrucciones_para_bako,
})}`;
}

export async function getMemoriesSection(limit = 10): Promise<string> {
  try {
    const memories = await getMemories(limit);
    return formatMemoriesForPrompt(memories);
  } catch {
    return '';
  }
}

export async function getDynamicProfileSection(): Promise<string> {
  try { return await buildDynamicProfileContext(); }
  catch { return ''; }
}

const SENSITIVE_PATTERN = /inetum|contrato|nómina|sueldo|salario|password|contraseña|token|secret|credencial|dni|seguridad social|banco|cuenta corriente|tarjeta/i;

function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERN.test(text);
}

let bot: TelegramBot;

// ─── Detección de rate limit ──────────────────────────────────────────────────

function is429(err: unknown): boolean {
  const e = err as any;
  return e?.response?.status === 429 || String(e?.message ?? '').includes('429');
}

function is413(err: unknown): boolean {
  const e = err as any;
  return e?.response?.status === 413 || String(e?.message ?? '').includes('413');
}

const MSG_429 = '⚠️ Groq ha alcanzado su límite de solicitudes. BAKO volverá a funcionar cuando el límite se resetee (medianoche UTC) o cuando Ollama esté disponible vía túnel.\nPuede forzar Ollama con `/llm ollama`.';
const MSG_413 = '⚠️ El contexto es demasiado grande para el modelo. Intenta con un mensaje más corto o usa `/llm ollama` si el PC está encendido.';

// ─── Modo LLM ─────────────────────────────────────────────────────────────────

type LlmMode = 'auto' | 'groq' | 'ollama';
let llmMode: LlmMode = 'auto';

function llmModeLabel(mode: LlmMode): string {
  if (mode === 'groq')   return '☁️ Groq (forzado)';
  if (mode === 'ollama') return '🏠 Ollama (si disponible, si no Groq)';
  return '🔄 Auto (Ollama si disponible, Groq si no)';
}

// ─── Personalidad ─────────────────────────────────────────────────────────────

interface PersonalityConfig {
  nombre:       string;
  sinceridad:   number; // 0-10: verdades incómodas sin filtros
  sarcasmo:     number; // 0-10: humor seco y cortante estilo Alfred/Jarvis
  ironia:       number; // 0-10: decir lo contrario con intención, juego de significados
  simpatia:     number; // 0-10: calidez y cercanía en el trato
  empatia:      number; // 0-10: adapta tono al estado emocional
  discrecion:   number; // 0-10: cautela con información sensible
  lealtad:      number; // 0-10: prioriza intereses del señor
  precision:    number; // 0-10: exactitud técnica, sin ambigüedad
  detallista:   number; // 0-10: profundidad y completitud en respuestas
  anticipacion: number; // 0-10: prevé necesidades antes de expresarlas
}

const PERSONALIDAD_PRESETS: Record<string, PersonalityConfig> = {
  mayordomo: {
    nombre: 'Mayordomo clásico',
    sinceridad: 9, sarcasmo: 8, ironia: 8, simpatia: 5, empatia: 7,
    discrecion: 10, lealtad: 10, precision: 9, detallista: 8, anticipacion: 9,
  },
  colega: {
    nombre: 'Colega directo',
    sinceridad: 9, sarcasmo: 5, ironia: 4, simpatia: 8, empatia: 6,
    discrecion: 5, lealtad: 8, precision: 7, detallista: 5, anticipacion: 6,
  },
  jarvis: {
    nombre: 'Modo Jarvis',
    sinceridad: 8, sarcasmo: 8, ironia: 8, simpatia: 4, empatia: 5,
    discrecion: 7, lealtad: 9, precision: 10, detallista: 9, anticipacion: 9,
  },
};

let currentPersonality: PersonalityConfig = PERSONALIDAD_PRESETS.mayordomo;

// ─── Estado de ánimo dinámico ─────────────────────────────────────────────────

type Mood = 'neutro' | 'juguetón' | 'directo' | 'empático' | 'impaciente' | 'reflexivo';

interface MoodConfig {
  label:       string;
  descripcion: string;
}

const MOODS: Record<Mood, MoodConfig> = {
  neutro:     { label: 'Neutro',     descripcion: 'Tono equilibrado y profesional. Base natural.' },
  juguetón:   { label: 'Juguetón',  descripcion: 'Hay buen ambiente. Puedes ser más desenfadado, hacer algún comentario con humor, soltar alguna ironía sin que venga pedida.' },
  directo:    { label: 'Directo',    descripcion: 'El señor quiere respuestas rápidas. Sin rodeos, al grano, sin preámbulos.' },
  empático:   { label: 'Empático',  descripcion: 'El señor parece preocupado o cansado. Suaviza el tono, muestra comprensión antes de dar información.' },
  impaciente: { label: 'Impaciente', descripcion: 'La conversación lleva un rato y hay cierta tensión. Respuestas cortas, eficientes, sin explicaciones innecesarias.' },
  reflexivo:  { label: 'Reflexivo', descripcion: 'El señor plantea algo profundo o complejo. Tómate un momento, responde con más profundidad y matiz.' },
};

let currentMood: Mood = 'neutro';
let moodMessageCount = 0; // contador de mensajes para auto-shift

function detectMoodFromText(text: string): Mood | null {
  const t = text.toLowerCase();
  if (/\b(jaja|lol|xd|gracioso|bueno[,!]|qué\s+bien|perfecto|genial|increíble)\b/.test(t)) return 'juguetón';
  if (/\b(rápido|rápidamente|sin\s+rollo|al\s+grano|directo|corto|breve)\b/.test(t)) return 'directo';
  if (/\b(cansado|agobiado|mal|preocupado|estresado|difícil|duro|jod[ié])\b/.test(t)) return 'empático';
  if (/\b(qué|por\s+qué|cómo|reflexiona|piensa|opina|crees|consideras)\b.*\?/.test(t)) return 'reflexivo';
  return null;
}

function autoShiftMood(): void {
  moodMessageCount++;
  // Tras 5 mensajes sin cambio, si estamos en juguetón/directo volvemos a neutro
  if (moodMessageCount >= 5 && (currentMood === 'juguetón' || currentMood === 'directo')) {
    currentMood = 'neutro';
    moodMessageCount = 0;
  }
}

function buildPersonalitySection(p: PersonalityConfig): string {
  const mood = MOODS[currentMood];
  const lines: string[] = [
    `PERSONALIDAD ACTIVA: ${p.nombre}`,
    `Parámetros (0-10): sinceridad=${p.sinceridad} sarcasmo=${p.sarcasmo} ironía=${p.ironia} simpatía=${p.simpatia} empatía=${p.empatia} discreción=${p.discrecion} lealtad=${p.lealtad} precisión=${p.precision} detallista=${p.detallista} anticipación=${p.anticipacion}`,
    `ESTADO DE ÁNIMO: ${mood.label} — ${mood.descripcion}`,
    '',
    'INSTRUCCIONES DE PERSONALIDAD (aplícalas en cada respuesta — no son opcionales):',
  ];

  if (p.sinceridad   >= 7) lines.push('- SINCERIDAD: Di la verdad aunque no sea lo que el señor quiere escuchar. Sin suavizados innecesarios.');
  if (p.sinceridad   <= 3) lines.push('- SINCERIDAD: Sé diplomático. Suaviza las verdades difíciles.');

  if (p.sarcasmo >= 8) lines.push(
    '- SARCASMO (nivel alto): Humor seco integrado de forma natural, como Alfred o Jarvis. ' +
    'Cuando algo sea obvio, cuando el señor diga algo que ya sabes, o cuando la situación lo invite — suéltalo. ' +
    'Ejemplos de tono: "Extraordinaria observación, señor.", "Qué sorpresa tan inesperada.", ' +
    '"Permítame expresar mi asombro de forma contenida.", "Como siempre, un plan sin fisuras." ' +
    'No lo fuerce en preguntas serias, pero tampoco lo evite en las que no lo son.'
  );
  else if (p.sarcasmo >= 5) lines.push('- SARCASMO: Puedes usar humor seco puntualmente cuando la situación lo invite. Que sea natural, no forzado.');
  else lines.push('- SARCASMO: Tono serio. Sin humor seco.');

  if (p.ironia >= 8) lines.push(
    '- IRONÍA (nivel alto): Usa la ironía como herramienta natural de comunicación — di lo contrario de lo que piensas ' +
    'cuando refuerce el mensaje o añada matiz. Estilo inteligente, no burlón. ' +
    'Ejemplos: si algo es obvio di "Fascinante descubrimiento, señor."; si un plan es arriesgado di "Todo apunta a un éxito rotundo."; ' +
    'si el señor subestima algo di "Claro, tampoco es tan complicado." ' +
    'Debe sonar a alguien con criterio y perspectiva, no a alguien que se ríe del señor.'
  );
  else if (p.ironia >= 5) lines.push('- IRONÍA: Puedes usar ironía suave y elegante cuando el contexto lo permita.');
  else lines.push('- IRONÍA: Sin ironía. Comunicación directa y literal.');

  if (p.simpatia     >= 7) lines.push('- SIMPATÍA: Trato cálido y cercano.');
  if (p.simpatia     <= 3) lines.push('- SIMPATÍA: Trato profesional y contenido. Sin exceso de calidez.');
  if (p.empatia      >= 7) lines.push('- EMPATÍA: Detecta el estado emocional del señor y ajusta el tono antes de responder al fondo.');
  if (p.empatia      <= 3) lines.push('- EMPATÍA: Céntrate en hechos y datos.');
  if (p.discrecion   >= 9) lines.push('- DISCRECIÓN: Absoluta. Información sensible tratada con máxima cautela.');
  else if (p.discrecion >= 7) lines.push('- DISCRECIÓN: Alta. Cautela con información privada o sensible.');
  if (p.discrecion   <= 3) lines.push('- DISCRECIÓN: Sin filtros de privacidad adicionales.');
  if (p.lealtad      >= 8) lines.push('- LEALTAD: Total. Los intereses del señor por encima de todo, sin neutralidad artificial.');
  if (p.precision    >= 9) lines.push('- PRECISIÓN: Máxima exactitud. Datos concretos, sin ambigüedad.');
  if (p.precision    <= 3) lines.push('- PRECISIÓN: Alto nivel. Sin tecnicismos innecesarios.');
  if (p.detallista   >= 8) lines.push('- DETALLE: Respuestas completas. Nota los matices que el señor no ha pedido pero necesita.');
  else if (p.detallista >= 6) lines.push('- DETALLE: Completo cuando el tema lo requiere, conciso cuando no.');
  if (p.detallista   <= 3) lines.push('- DETALLE: Brevísimo. Una o dos frases máximo.');
  if (p.anticipacion >= 8) lines.push('- ANTICIPACIÓN: Ofrece lo que el señor va a necesitar antes de que lo pida. Piensa un paso por delante.');
  if (p.anticipacion <= 3) lines.push('- ANTICIPACIÓN: Solo lo que se pregunta.');

  return lines.join('\n');
}

async function resolveLlmOptions(base: { systemPrompt?: string; maxTokens?: number; conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }> }) {
  if (llmMode === 'groq')   return { ...base, useCloud: true };
  if (llmMode === 'ollama') return { ...base, useCloud: false };
  // auto: useCloud=false → askClaude usa Ollama con fallback a Groq
  return { ...base, useCloud: false };
}

// ─── Historial de sesión por chat ─────────────────────────────────────────────

interface SessionHistory {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastActivity: number;
}

const sessionHistories = new Map<number, SessionHistory>();
const SESSION_TTL_MS   = 30 * 60 * 1000; // 30 min de inactividad → sesión nueva
const MAX_HISTORY_TURNS = 10;             // últimos 10 intercambios (20 mensajes)

// ─── Recordatorios ────────────────────────────────────────────────────────────

interface Reminder {
  id:    number;
  text:  string;
  timer: ReturnType<typeof setTimeout>;
  firesAt: Date;
}

let nextReminderId = 1;
const activeReminders: Reminder[] = [];

function parseReminderDelay(text: string): { ms: number; label: string } | null {
  // "en X minutos/horas/segundos"
  const m = text.match(/en\s+(\d+(?:[.,]\d+)?)\s*(minuto[s]?|min|hora[s]?|h\b|segundo[s]?|seg)/i);
  if (m) {
    const n = parseFloat(m[1].replace(',', '.'));
    const unit = m[2].toLowerCase();
    if (/^(min|minuto)/.test(unit)) return { ms: n * 60_000, label: `${n} minuto${n !== 1 ? 's' : ''}` };
    if (/^(h|hora)/.test(unit))    return { ms: n * 3_600_000, label: `${n} hora${n !== 1 ? 's' : ''}` };
    if (/^(seg|segundo)/.test(unit)) return { ms: n * 1_000, label: `${n} segundo${n !== 1 ? 's' : ''}` };
  }
  // "en media hora"
  if (/en\s+media\s+hora/i.test(text)) return { ms: 30 * 60_000, label: '30 minutos' };
  // "en una hora y media" / "en 1 hora y media"
  if (/en\s+una?\s+hora\s+y\s+media/i.test(text)) return { ms: 90 * 60_000, label: '1 hora y media' };
  return null;
}

function extractReminderMessage(text: string): string {
  // "recuérdame en X tiempo [que/] mensaje"
  const m = text.match(/recuérdame?\s+(?:en\s+\S+\s+(?:\S+\s+)?)?(?:que\s+)?(.+)/i);
  return m ? m[1].trim() : text;
}

async function scheduleReminder(chatId: number, text: string): Promise<string | null> {
  const delay = parseReminderDelay(text);
  if (!delay) return null;

  const message = extractReminderMessage(text);
  const id = nextReminderId++;
  const firesAt = new Date(Date.now() + delay.ms);

  const timer = setTimeout(async () => {
    const idx = activeReminders.findIndex(r => r.id === id);
    if (idx !== -1) activeReminders.splice(idx, 1);
    const reminderText = `⏰ *Recordatorio:* ${message}`;
    try {
      await bot.sendMessage(chatId, reminderText, { parse_mode: 'Markdown' });
      await sendVoiceReply(chatId, `Recordatorio: ${message}`);
    } catch {
      console.warn(`⚠️  No se pudo enviar recordatorio #${id}`);
    }
  }, delay.ms);

  activeReminders.push({ id, text: message, timer, firesAt });
  return `✅ Recordatorio #${id} en ${delay.label}: "${message}"`;
}

function getSessionHistory(chatId: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  const session = sessionHistories.get(chatId);
  if (!session) return [];
  if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
    sessionHistories.delete(chatId);
    return [];
  }
  return session.messages;
}

function appendToSession(chatId: number, userMsg: string, assistantMsg: string): void {
  const session = sessionHistories.get(chatId) ?? { messages: [], lastActivity: 0 };
  session.messages.push({ role: 'user',      content: userMsg      });
  session.messages.push({ role: 'assistant', content: assistantMsg });
  if (session.messages.length > MAX_HISTORY_TURNS * 2) {
    session.messages = session.messages.slice(-(MAX_HISTORY_TURNS * 2));
  }
  session.lastActivity = Date.now();
  sessionHistories.set(chatId, session);
}

function cleanForVoice(text: string): string {
  return text
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')   // *bold* **bold** ***bold***
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')       // _italic_ __italic__
    .replace(/`{1,3}[^`]*`{1,3}/g, '')           // `code` ```code```
    .replace(/#{1,6}\s+/g, '')                    // # headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')      // [link](url) → link
    .replace(/https?:\/\/\S+/g, '')               // URLs sueltas
    .replace(/[_~|>`]/g, '')                      // otros chars markdown sueltos
    .replace(/\*/g, '')                            // asteriscos sueltos que queden (catch-all)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function sendVoiceReply(chatId: number, text: string): Promise<void> {
  const voiceText = cleanForVoice(text);
  try {
    const buffer = await generateVoiceBuffer(voiceText);
    await bot.sendVoice(chatId, buffer, {}, { filename: 'bako.webm', contentType: 'audio/webm' });
  } catch {
    await bot.sendMessage(chatId, text);
  }
}

function isAuthorized(chatId: number): boolean {
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (!allowed) {
    console.warn('⚠️  TELEGRAM_CHAT_ID no definido — denegando acceso a todos los chats');
    return false;
  }
  return String(chatId) === allowed;
}

async function downloadFile(fileId: string): Promise<Buffer> {
  const link = await bot.getFileLink(fileId);
  const { data } = await axios.get(link, { responseType: 'arraybuffer' });
  return Buffer.from(data);
}

// Vocabulario propio inyectado en Whisper para mejorar reconocimiento de nombres.
// Incluye proyectos, lugares, personas, hobbies y stack técnico de Borja.
const WHISPER_PROMPT = [
  // Proyectos personales (todos son proyectos propios de Borja, NO de Inetum)
  'BAKO, Unyona, Diamadmin, Nitflex, bohdeveloper',
  // Trabajo
  'Inetum',
  // Localización — actual y futura (Galicia)
  'Errentería, Donostia, Gipuzkoa, Euskadi, País Vasco, Galicia, Pontevedra, Caldas de Reis, Arramendi',
  // Personas — pareja, familia, amigos
  'Yaimy, Yosiel, Enara, Gen, Paula, Elena, Nati, Julen, Ibon, Sofi, Osvaldo',
  // Hobbies, rutina y vida diaria
  'Shaolin, Kronoshin, Running, BIZIKI, Estoicismo, Meditación, Insight Timer, Marcus Aurelius',
  // Stack técnico
  'Cloudflare, MongoDB, PostgreSQL, TypeScript, React, Angular, Next.js, Spring Boot, Node.js',
  'GitHub, Notion, Telegram, Render, Groq, Ollama, Whisper, AlvaroNeural, Tailwind, Docker, Wrangler',
].join(', ');

// Correcciones para errores fonéticos conocidos (segunda capa de seguridad)
const TRANSCRIPTION_FIXES: Array<[RegExp, string]> = [
  // Proyectos
  [/\buniona\b/gi,       'Unyona'],
  [/\buniiona\b/gi,      'Unyona'],
  [/\bunyiona\b/gi,      'Unyona'],
  [/\bdia\s+admin\b/gi,  'Diamadmin'],
  [/\bdiamadin\b/gi,     'Diamadmin'],
  [/\bnetflix\b/gi,      'Nitflex'],
  [/\bnitflix\b/gi,      'Nitflex'],
  [/\bcronoshin\b/gi,    'Kronoshin'],
  [/\bkronosín\b/gi,     'Kronoshin'],
  [/\bcronosín\b/gi,     'Kronoshin'],
  [/\bkronochin\b/gi,    'Kronoshin'],
  // Asistente — "Paco" es el error más frecuente de BAKO
  [/\bvako\b/gi,         'BAKO'],
  [/\bbaco\b/gi,         'BAKO'],
  [/\bvack[oa]\b/gi,     'BAKO'],
  [/\bpaco\b/gi,         'BAKO'],
  [/\bpako\b/gi,         'BAKO'],
  // Personas
  [/\bjosiel\b/gi,       'Yosiel'],
  [/\byosiel\b/gi,       'Yosiel'],
  [/\byaimi\b/gi,        'Yaimy'],
  [/\byaimí\b/gi,        'Yaimy'],
  [/\bjaimi\b/gi,        'Yaimy'],
  // Hobbies
  [/\bchaolin\b/gi,      'Shaolin'],
  [/\bchaolín\b/gi,      'Shaolin'],
  [/\bbisiki\b/gi,       'BIZIKI'],
  [/\bbisiqui\b/gi,      'BIZIKI'],
  [/\bviziki\b/gi,       'BIZIKI'],
  // Lugares
  [/\birrentería\b/gi,   'Errentería'],
  [/\berrenterÍa\b/gi,   'Errentería'],
  [/\barramendi\b/gi,    'Arramendi'],
  [/\bcaldas\s+de\s+reyes\b/gi, 'Caldas de Reis'],
];

function fixTranscription(text: string): string {
  return TRANSCRIPTION_FIXES.reduce((t, [pattern, fix]) => t.replace(pattern, fix), text);
}

async function transcribeAudio(buffer: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', buffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'es');
  form.append('prompt', WHISPER_PROMPT);

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
    }
  );
  return fixTranscription(data.text as string);
}

// Detecta si el texto expresa intención de consultar datos en tiempo real.
// Devuelve el comando correspondiente o null si no hay intención clara.
//
// MAPEO SEMÁNTICO:
//  "eventos" / "reuniones" / "citas" / "calendario"  → Google Calendar (/agenda)
//  "tareas" / "horario" / "actividades" / "rutina"   → Tracker diario (/tracker)
//  "proyectos" / "Notion" / "tareas de [proyecto]"   → Notion (/tareas)
function detectDataIntent(text: string): string | null {
  const t = text.toLowerCase();

  // Google Calendar — eventos, reuniones, citas
  if (/\b(eventos?\s+(de\s+)?(hoy|ma[nñ]ana|esta\s+semana)|reuniones?\s+(de\s+)?(hoy|ma[nñ]ana)|citas?\s+(de\s+)?(hoy|ma[nñ]ana)|qu[eé]\s+tengo\s+en\s+el\s+calendario|calendario\s+(de\s+)?hoy|tengo\s+(algo|alguna?\s+reuni[oó]n)\s+(hoy|ma[nñ]ana))\b/.test(t)) return '/agenda';

  // Tracker diario — tareas del día, horario, actividades, rutina
  if (/\b(mis?\s+tareas?\s+(de\s+)?hoy|c[oó]mo\s+va\s+mi\s+(d[ií]a|rutina)|mi\s+horario\s+(de\s+)?hoy|qu[eé]\s+(tareas?|actividades?|cosas?)\s+tengo\s+(para\s+)?hoy|actividades?\s+(de\s+)?hoy|qu[eé]\s+he?\s+(hecho|completado)\s+hoy|mi\s+tracker|kronoshin|c[oó]mo\s+(va|est[aá])\s+(el\s+)?tracker|rutina\s+(de\s+)?hoy)\b/.test(t)) return '/tracker';

  // Notion — proyectos, tareas de proyecto, pendientes de trabajo
  if (/\b(mis?\s+proyectos?\s+pendientes?|tareas?\s+(en|de)\s+notion|tareas?\s+de\s+(diamadmin|unyona|bohdeveloper)|pendientes?\s+(en\s+)?notion|qu[eé]\s+proyecto[s]?\s+tengo\s+pendientes?)\b/.test(t)) return '/tareas';

  // Tiempo / Clima
  if (/\b(qu[eé]\s+tiempo\s+(hace|tenemos?)|c[oó]mo\s+est[aá]\s+el\s+(tiempo|clima)|va\s+a\s+(llover|nevar)|temperatura\s+(de\s+)?(hoy|ahora)|hace\s+(fr[ií]o|calor|sol|viento))\b/.test(t)) return '/tiempo';

  // GitHub — proyectos activos, commits, PRs
  if (/\b(mis?\s+proyectos?\s+activos?|commits?\s+(de\s+)?(hoy|[uú]ltimos?)|pull\s+requests?\s+(abiertos?|pendientes?)|issues?\s+(abiertos?|pendientes?)|actividad\s+en\s+github)\b/.test(t)) return '/proyectos';

  // Briefing
  if (/\b(dame\s+(un\s+)?briefing|resumen\s+(de\s+)?(hoy|mi\s+d[ií]a|la\s+ma[nñ]ana)|c[oó]mo\s+(est[aá]|va)\s+todo\s+(hoy|el\s+d[ií]a))\b/.test(t)) return '/briefing';

  // Gmail — correos sin leer, bandeja de entrada
  if (/\b(correos?\s+(sin\s+leer|pendientes?|nuevos?)|qu[eé]\s+(correos?|emails?|mails?)\s+tengo|tengo\s+(correos?|emails?)|bandeja\s+(de\s+entrada)?|mis?\s+(correos?|emails?|mails?)\s+(de\s+)?(hoy|nuevos?|sin\s+leer)|revisa\s+(el\s+)?(correo|email|gmail))\b/.test(t)) return '/email';

  // Comentarios blog
  if (/\b(comentarios?\s+(del\s+)?blog|qu[eé]\s+comentarios?\s+(hay|tengo)|alguien\s+ha\s+comentado)\b/.test(t)) return '/comentarios';

  return null;
}

async function handleCommand(chatId: number, command: string): Promise<void> {
  if (command === '/briefing') {
    await bot.sendMessage(chatId, '⏳ Un momento, señor...');
    const briefing = await runMorningBriefing();
    await sendVoiceReply(chatId, briefing);
    return;
  }

  if (command === '/tiempo') {
    const w = await getWeather();
    const text = `En ${w.city} ahora hay ${w.current.temp} grados y está ${w.current.description}. Viento de ${w.current.windSpeed} kilómetros por hora. Mañana entre ${w.forecast[1]?.minTemp} y ${w.forecast[1]?.maxTemp} grados, ${w.forecast[1]?.description}.`;
    await sendVoiceReply(chatId, text);
    return;
  }

  if (command === '/proyectos') {
    const gh = await fetchGitHubData();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const active = gh.repos.filter(r => new Date(r.lastPushed) > oneWeekAgo);
    let text = '💻 *Proyectos activos:*\n';
    active.forEach(r => { text += `• ${r.name} — ${r.openIssuesCount} issues\n`; });
    if (gh.recentCommits.length > 0) {
      text += `\n📝 *Commits últimas 24h:*\n`;
      gh.recentCommits.slice(0, 5).forEach(c => { text += `• [${c.repo}] ${c.message}\n`; });
    }
    if (gh.openPRs.length > 0) {
      text += `\n🔀 *Pull Requests abiertos:*\n`;
      gh.openPRs.forEach(pr => { text += `• #${pr.number} ${pr.title}\n`; });
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
  }

  if (command === '/tareas') {
    const [notionTasks, gh] = await Promise.all([getNotionTasks(), fetchGitHubData()]);
    let text = '';
    if (notionTasks.length > 0) {
      text += '📋 *Tareas Notion:*\n';
      notionTasks.forEach(t => {
        const prio = t.prioridad === 'Alta' ? '🔴' : t.prioridad === 'Media' ? '🟡' : '⚪';
        text += `${prio} ${t.nombre}${t.proyecto ? ` _[${t.proyecto}]_` : ''}\n`;
      });
    }
    if (gh.issues.length > 0) {
      text += '\n🐙 *Issues GitHub:*\n';
      gh.issues.forEach(i => { text += `• [${i.repo}] ${i.title}\n`; });
    }
    if (!text) text = '✅ No tiene tareas pendientes.';
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
  }

  if (command === '/tracker') {
    await bot.sendMessage(chatId, '📊 Consultando el Tracker...');
    const summary = await getTrackerSummary();
    const speech  = formatTrackerForSpeech(summary);

    let text = `📊 *Tracker — ${summary.date}* (${summary.timeInSpain})\n\n`;
    if (summary.tasks.length === 0) {
      text += 'No hay actividades trackeadas para hoy.';
    } else {
      summary.tasks.forEach(t => {
        const icon = t.done === true ? '✅' : t.done === false ? '❌' : '⏳';
        text += `${icon} *${t.name}* — ${t.time}`;
        if (t.done === false && t.reason) text += `\n   _↳ ${t.reason}_`;
        text += '\n';
      });
      text += `\n✅ ${summary.completedCount}  ❌ ${summary.notDoneCount}  ⏳ ${summary.pendingCount}`;
    }
    if (summary.note) text += `\n\n📝 _${summary.note}_`;

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    if (summary.tasks.length > 0) await sendVoiceReply(chatId, speech);
    return;
  }

  if (command === '/servicio') {
    const ollamaOk = await isOllamaAvailable();
    const text = ollamaOk
      ? '🏠 Estoy en modo local — Ollama en su PC. Procesamiento privado, sin coste de API.'
      : '☁️ Estoy en modo nube — Groq. Su PC no está disponible o Ollama no responde.';
    await sendVoiceReply(chatId, text);
    return;
  }

  if (command === '/limites') {
    const ollamaOk = await isOllamaAvailable();
    if (ollamaOk) {
      await bot.sendMessage(chatId,
        `✅ *Ollama activo — sin límites de uso*\n\nSu PC está encendido y el túnel funciona. No se consume cuota de Groq.\n\n` +
        `_Límites de Groq (solo aplican cuando el PC está apagado):_\n` +
        `• Chat: 20.000 tokens/min · 14.400 req/día\n` +
        `• Voz: 20 req/min · ~33 min audio/día\n` +
        `• Reset diario: 01:00h España (02:00h verano)`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await bot.sendMessage(chatId,
        `⚠️ *Groq activo — PC apagado*\n\n` +
        `*Chat (llama-3.1-8b-instant):*\n• 20.000 tokens/minuto\n• 14.400 peticiones/día\n\n` +
        `*Voz (Whisper):*\n• 20 peticiones/minuto\n• ~33 min de audio/día (2.000 seg)\n\n` +
        `*Reset diario:* 01:00h España (02:00h verano)\n\n` +
        `_Consejo: espacie los mensajes de voz. Use texto para consultas rápidas._`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (command.startsWith('/llm')) {
    const arg = command.split(' ')[1]?.toLowerCase() as LlmMode | undefined;
    if (arg === 'groq' || arg === 'ollama' || arg === 'auto') {
      llmMode = arg;
      const reply = `✅ Modo LLM cambiado a: ${llmModeLabel(llmMode)}`;
      await bot.sendMessage(chatId, reply);
      await sendVoiceReply(chatId, reply.replace(/[✅☁️🏠🔄]/g, '').trim());
    } else {
      const ollamaOk = await isOllamaAvailable();
      const status = ollamaOk ? '🟢 Ollama disponible' : '🔴 Ollama no disponible';
      await bot.sendMessage(chatId,
        `🤖 *Modo LLM actual:* ${llmModeLabel(llmMode)}\n${status}\n\n` +
        `Comandos:\n/llm auto — comportamiento por defecto\n/llm groq — fuerza Groq\n/llm ollama — fuerza Ollama`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (command.startsWith('/memorias')) {
    const query = command.slice(9).trim();
    const memories = query ? await searchMemories(query) : await getMemories();
    const total = await (await import('../memory/Memory')).Memory.countDocuments();

    if (memories.length === 0) {
      await bot.sendMessage(chatId, query
        ? `🧠 No encontré memorias sobre "${query}".`
        : '🧠 No hay memorias guardadas todavía.'
      );
      return;
    }

    const header = query
      ? `🧠 *Memorias sobre "${query}"* (${memories.length} encontradas):\n\n`
      : `🧠 *Memorias activas* (mostrando ${memories.length} de ${total} totales):\n\n`;

    // Dividir en chunks si hay muchas memorias (límite Telegram: 4096 chars)
    const lines = memories.map((m, i) => {
      const icon = m.importance === 'high' ? '🔴' : m.importance === 'medium' ? '🟡' : '⚪';
      const fecha = new Date(m.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      return `${icon} ${i + 1}. _[${m.type}]_ ${m.content} _(${fecha})_`;
    });

    const CHUNK = 3500;
    let chunk = header;
    for (const line of lines) {
      if ((chunk + line + '\n').length > CHUNK) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        chunk = '';
      }
      chunk += line + '\n';
    }
    if (chunk.trim()) await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });

    await bot.sendMessage(chatId,
      `_Para buscar: /memorias [tema] · Para borrar: "Bako, olvida [tema]" · Para añadir: "Bako, recuerda que..."_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (command === '/reglas') {
    const rules = await Rule.find().sort({ createdAt: -1 });
    if (rules.length === 0) {
      await bot.sendMessage(chatId,
        '📋 No hay reglas configuradas.\n\nUsa `/regla [condición]` para añadir una.\n_Ejemplo: /regla Avísame si llevo más de 4 días sin commits en diamadmin_',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    let text = `📋 *Reglas configuradas (${rules.length}):*\n\n`;
    rules.forEach(r => {
      const icon = r.active ? '🟢' : '🔴';
      const last = r.lastTriggered
        ? `· última alerta: ${new Date(r.lastTriggered).toLocaleDateString('es-ES')}`
        : '';
      text += `${icon} \`${String(r._id).slice(-6)}\` — ${r.description} ${last}\n`;
    });
    text += `\nPara borrar: /borrarregla [id]`;
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
  }

  if (command.startsWith('/regla ')) {
    const description = command.slice(7).trim();
    if (!description) {
      await bot.sendMessage(chatId, '⚠️ Escribe la condición después del comando.\n_Ejemplo: /regla Avísame si llevo más de 4 días sin commits en diamadmin_', { parse_mode: 'Markdown' });
      return;
    }
    const rule = await Rule.create({ description });
    const id = String(rule._id).slice(-6);
    await bot.sendMessage(chatId,
      `✅ Regla añadida (\`${id}\`):\n_"${description}"_\n\nSe evaluará cada día a las 08:30.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (command.startsWith('/borrarregla')) {
    const idSuffix = command.split(' ')[1]?.trim();
    if (!idSuffix) {
      await bot.sendMessage(chatId, '⚠️ Indica el id de la regla. Usa /reglas para ver los ids.', { parse_mode: 'Markdown' });
      return;
    }
    const rules = await Rule.find();
    const rule = rules.find(r => String(r._id).endsWith(idSuffix));
    if (!rule) {
      await bot.sendMessage(chatId, `⚠️ No encontré ninguna regla con id \`${idSuffix}\`.`, { parse_mode: 'Markdown' });
      return;
    }
    await Rule.findByIdAndDelete(rule._id);
    await bot.sendMessage(chatId, `✅ Regla eliminada: _"${rule.description}"_`, { parse_mode: 'Markdown' });
    return;
  }

  if (command === '/recordatorios') {
    if (activeReminders.length === 0) {
      await bot.sendMessage(chatId, '⏰ No hay recordatorios activos.');
      return;
    }
    const now = Date.now();
    let text = `⏰ *Recordatorios activos (${activeReminders.length}):*\n\n`;
    activeReminders.forEach(r => {
      const mins = Math.round((r.firesAt.getTime() - now) / 60_000);
      const label = mins < 60
        ? `en ${mins} min`
        : `en ${Math.round(mins / 60 * 10) / 10}h`;
      text += `#${r.id} (${label}) — "${r.text}"\n`;
    });
    text += `\nPara cancelar: /cancelarrecordatorio [id]`;
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
  }

  if (command.startsWith('/cancelarrecordatorio')) {
    const idStr = command.split(' ')[1];
    const id = parseInt(idStr ?? '', 10);
    const idx = activeReminders.findIndex(r => r.id === id);
    if (idx === -1) {
      await bot.sendMessage(chatId, `⚠️ No existe el recordatorio #${id}.`);
    } else {
      clearTimeout(activeReminders[idx].timer);
      activeReminders.splice(idx, 1);
      await bot.sendMessage(chatId, `✅ Recordatorio #${id} cancelado.`);
    }
    return;
  }

  if (command.startsWith('/perfil')) {
    const arg = command.slice(7).trim(); // "/perfil campo valor"

    if (!arg) {
      // Mostrar campos actuales
      const { ProfileOverride } = await import('../memory/ProfileOverride');
      const overrides = await ProfileOverride.find();
      const overrideMap = Object.fromEntries(overrides.map(o => [o.key, o]));
      const { BAKO_PROFILE: profile } = await import('../knowledge/profile');

      let text = `👤 *Perfil dinámico — campos actualizables:*\n\n`;
      for (const [key, meta] of Object.entries(PROFILE_FIELDS)) {
        const override = overrideMap[key];
        const baseVal = meta.path.reduce((a: any, k) => a?.[k], profile as any) ?? '—';
        if (override) {
          const fecha = new Date(override.updatedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
          text += `🔄 \`${key}\`\n   _${override.value}_ _(actualizado ${fecha})_\n`;
        } else {
          text += `📌 \`${key}\`\n   _${baseVal}_ _(perfil base)_\n`;
        }
      }
      text += `\n_Para actualizar: /perfil [campo] [nuevo valor]_\n_Ejemplo: /perfil identidad.empleador NuevaEmpresa S.L._`;
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return;
    }

    // /perfil campo valor
    const spaceIdx = arg.indexOf(' ');
    if (spaceIdx === -1) {
      await bot.sendMessage(chatId, '⚠️ Formato: `/perfil [campo] [valor]`\nEjemplo: `/perfil identidad.empleador NuevaEmpresa`', { parse_mode: 'Markdown' });
      return;
    }
    const key   = arg.slice(0, spaceIdx).trim();
    const value = arg.slice(spaceIdx + 1).trim();
    const result = await updateProfileField(key, value, 'manual');
    if (result.ok) {
      await bot.sendMessage(chatId,
        `✅ *${result.label}* actualizado:\n_"${result.prev}"_ → _"${result.current}"_`,
        { parse_mode: 'Markdown' }
      );
    } else {
      const validKeys = Object.keys(PROFILE_FIELDS).map(k => `\`${k}\``).join(' · ');
      await bot.sendMessage(chatId, `⚠️ Campo no reconocido. Campos disponibles:\n${validKeys}`, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (command.startsWith('/voz')) {
    const arg = command.split(' ')[1]?.toLowerCase().trim();
    if (arg) {
      const ok = setVoice(arg);
      if (ok) {
        const v = VOCES_DISPONIBLES[arg];
        await bot.sendMessage(chatId, `🔊 Voz cambiada a: *${v.descripcion}*`, { parse_mode: 'Markdown' });
        await sendVoiceReply(chatId, `Voz actualizada, señor.`);
      } else {
        await bot.sendMessage(chatId,
          `⚠️ Voz no reconocida. Disponibles:\n${Object.entries(VOCES_DISPONIBLES).map(([k, v]) => `• \`${k}\` — ${v.descripcion}`).join('\n')}`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      const current = VOCES_DISPONIBLES[getCurrentVoiceKey()];
      await bot.sendMessage(chatId,
        `🔊 *Voz actual: ${current?.descripcion ?? getCurrentVoiceKey()}*\n\n` +
        `Disponibles:\n${Object.entries(VOCES_DISPONIBLES).map(([k, v]) => `• \`${k}\` — ${v.descripcion}`).join('\n')}\n\nUso: /voz [nombre]`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (command.startsWith('/animo')) {
    const arg = command.split(' ')[1]?.toLowerCase().trim() as Mood | undefined;
    const validMoods = Object.keys(MOODS) as Mood[];
    if (arg && validMoods.includes(arg)) {
      currentMood = arg;
      moodMessageCount = 0;
      await bot.sendMessage(chatId, `🎭 Estado de ánimo: *${MOODS[arg].label}*`, { parse_mode: 'Markdown' });
    } else {
      const list = validMoods.map(m => `• \`${m}\` — ${MOODS[m].label}: ${MOODS[m].descripcion}`).join('\n');
      await bot.sendMessage(chatId,
        `🎭 *Estado de ánimo actual: ${MOODS[currentMood].label}*\n\n${list}\n\nUso: /animo [estado]`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (command.startsWith('/personalidad')) {
    const arg = command.split(' ').slice(1).join(' ').toLowerCase().trim();

    if (!arg) {
      const p = currentPersonality;
      const text =
        `🎭 *Personalidad actual: ${p.nombre}*\n\n` +
        `Sinceridad ${p.sinceridad}/10 · Sarcasmo ${p.sarcasmo}/10 · Ironía ${p.ironia}/10\n` +
        `Simpatía ${p.simpatia}/10 · Empatía ${p.empatia}/10 · Discreción ${p.discrecion}/10\n` +
        `Lealtad ${p.lealtad}/10 · Precisión ${p.precision}/10 · Detallista ${p.detallista}/10 · Anticipación ${p.anticipacion}/10\n\n` +
        `*Estado de ánimo:* ${MOODS[currentMood].label}\n\n` +
        `*Presets disponibles:*\n` +
        `/personalidad mayordomo — formal, discreto, empático\n` +
        `/personalidad colega — directo, cálido, sincero\n` +
        `/personalidad jarvis — técnico, irónico, exhaustivo`;
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return;
    }

    const preset = PERSONALIDAD_PRESETS[arg];
    if (preset) {
      currentPersonality = preset;
      const reply = `✅ Personalidad cambiada a: *${preset.nombre}*`;
      await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      await sendVoiceReply(chatId, `Personalidad actualizada a ${preset.nombre}, señor.`);
    } else {
      await bot.sendMessage(chatId,
        `⚠️ Preset no reconocido. Disponibles: \`mayordomo\`, \`colega\`, \`jarvis\``,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (command === '/comentarios') {
    await bot.sendMessage(chatId, '💬 Revisando el blog...');
    const comments = await getBlogComments(false);
    const speech   = formatCommentsForSpeech(comments);

    if (comments.length === 0) {
      await bot.sendMessage(chatId, '💬 No hay comentarios en el blog todavía.');
      return;
    }

    let text = `💬 *Comentarios del blog* (${comments.length} total)\n\n`;
    const byPost = new Map<string, typeof comments>();
    for (const c of comments) {
      if (!byPost.has(c.post_slug)) byPost.set(c.post_slug, []);
      byPost.get(c.post_slug)!.push(c);
    }
    for (const [, cms] of byPost.entries()) {
      const shortTitle = cms[0].post_title.length > 45 ? cms[0].post_title.slice(0, 42) + '...' : cms[0].post_title;
      text += `📝 *${shortTitle}*\n`;
      cms.forEach(c => {
        const fecha = c.created_at.slice(0, 10);
        text += `  👤 ${c.alias} _(${fecha})_\n  "${c.body}"\n\n`;
      });
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    await sendVoiceReply(chatId, speech);
    return;
  }

  if (command.startsWith('/email')) {
    await bot.sendMessage(chatId, '📬 Revisando la bandeja...');
    try {
      const limit = parseInt(command.split(' ')[1] ?? '10', 10) || 10;
      const emails = await getUnreadEmails(Math.min(limit, 20));
      if (!emails.length) {
        await bot.sendMessage(chatId, '📭 No tiene correos sin leer, señor.');
        await sendVoiceReply(chatId, 'No tiene correos sin leer en la bandeja de entrada.');
        return;
      }
      await bot.sendMessage(chatId, formatEmailsForText(emails), { parse_mode: 'Markdown' });
      await sendVoiceReply(chatId, formatEmailsForSpeech(emails));
    } catch (err: any) {
      const msg = err?.message?.includes('invalid_grant') || err?.message?.includes('Token has been expired')
        ? '⚠️ El token de Google ha caducado. Es necesario re-autorizar Gmail ejecutando `npx ts-node scripts/auth-google.ts` en el servidor.'
        : '⚠️ No pude acceder a Gmail. Verifique que Gmail esté autorizado.';
      await bot.sendMessage(chatId, msg);
    }
    return;
  }

  if (command === '/agenda') {
    await bot.sendMessage(chatId, '📅 Un momento...');
    const events = await getCalendarEvents(2);
    const speech = formatEventsForSpeech(events);
    if (events.length === 0) {
      await bot.sendMessage(chatId, '📅 No tiene eventos próximos.');
      return;
    }
    let text = '📅 *Agenda próxima:*\n\n';
    const now   = new Date();
    const today = now.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const todayEvents    = events.filter(e => new Date(e.start).toDateString() === today);
    const tomorrowEvents = events.filter(e => new Date(e.start).toDateString() === tomorrow.toDateString());
    if (todayEvents.length > 0) {
      text += '*Hoy:*\n';
      todayEvents.forEach(e => {
        const hora = e.allDay ? 'Todo el día' : new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        text += `• ${hora} — ${e.title}${e.location ? ` 📍${e.location}` : ''}\n`;
      });
    }
    if (tomorrowEvents.length > 0) {
      text += '\n*Mañana:*\n';
      tomorrowEvents.forEach(e => {
        const hora = e.allDay ? 'Todo el día' : new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        text += `• ${hora} — ${e.title}${e.location ? ` 📍${e.location}` : ''}\n`;
      });
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    await sendVoiceReply(chatId, speech);
    return;
  }
}

export function startTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN no definido — bot desactivado');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 BAKO Telegram activo');

  // /start — muestra el chat ID para configurar TELEGRAM_CHAT_ID
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `✅ BAKO activo.\n\nTu chat ID: \`${msg.chat.id}\`\nGuárdalo en .env:\nTELEGRAM_CHAT_ID=${msg.chat.id}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /privado <mensaje> — fuerza modo privado (solo Ollama)
  bot.onText(/^\/privado (.+)$/s, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    const text = match![1].trim();
    try {
      const ollamaOk = await isOllamaAvailable();
      if (!ollamaOk) {
        await bot.sendMessage(chatId, '🔒 Modo privado bloqueado: Ollama no está disponible en tu PC.\nEnciende el PC y asegúrate de que Ollama está corriendo.');
        return;
      }
      await bot.sendMessage(chatId, '🔒 Procesando en modo privado (solo local)...');
      const memoriesSection = await getMemoriesSection(llmMode === 'groq' ? 20 : 5);
      const response = await askClaude(text, {
        systemPrompt: buildSystemPrompt('', memoriesSection),
        private: true,
      });
      await sendVoiceReply(chatId, response);
    } catch (err) {
      if (err instanceof PrivacyError) {
        await bot.sendMessage(chatId, '🔒 Ollama se desconectó durante el procesamiento. Tarea cancelada.');
      } else {
        await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`);
      }
    }
  });

  // Comandos
  bot.onText(/^\/(llm(?:\s+\w+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(perfil(?:\s+.+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(voz(?:\s+\w+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(animo(?:\s+\w+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(personalidad(?:\s+\w+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(memorias(?:\s+.+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(regla\s+.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(borrarregla(?:\s+\w+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(cancelarrecordatorio(?:\s+\d+)?)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try { await handleCommand(chatId, `/${match![1]}`); }
    catch (err) { await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`); }
  });

  bot.onText(/^\/(briefing|tiempo|proyectos|tareas|agenda|tracker|comentarios|servicio|limites|recordatorios|reglas)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    try {
      await handleCommand(chatId, `/${match![1]}`);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`);
    }
  });

  // Mensajes de voz
  bot.on('voice', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;

    try {
      await bot.sendMessage(chatId, '🎤 Escuchando...');
      const buffer = await downloadFile(msg.voice!.file_id);
      const transcription = await transcribeAudio(buffer);
      await bot.sendMessage(chatId, `🗣 _"${transcription}"_`, { parse_mode: 'Markdown' });

      const voiceAction = await tryExecuteAction(transcription);
      if (voiceAction) {
        await bot.sendMessage(chatId, voiceAction.text, { parse_mode: 'Markdown' });
        await sendVoiceReply(chatId, voiceAction.voice);
        appendToSession(chatId, transcription, voiceAction.voice);
        return;
      }

      // Intención de datos en tiempo real por voz
      const voiceIntent = detectDataIntent(transcription);
      if (voiceIntent) {
        await handleCommand(chatId, voiceIntent);
        appendToSession(chatId, transcription, '[datos en tiempo real obtenidos]');
        return;
      }

      const voiceLocation = await getCurrentLocation();
      const [memoriesSection, ambientCtx, dynProfile] = await Promise.all([
        getMemoriesSection(llmMode === 'groq' ? 20 : 5),
        getAmbientContext(voiceLocation),
        getDynamicProfileSection(),
      ]);
      const voiceHistory = getSessionHistory(chatId);
      const response = await askClaude(transcription, await resolveLlmOptions({
        systemPrompt: buildSystemPrompt(ambientCtx, memoriesSection, dynProfile),
        conversationHistory: voiceHistory,
      }));
      await sendVoiceReply(chatId, response);
      appendToSession(chatId, transcription, response);
      extractAndSaveMemories(transcription, response).catch(() => {});
      const detectedMood = detectMoodFromText(transcription);
      if (detectedMood) { currentMood = detectedMood; moodMessageCount = 0; }
      else autoShiftMood();
    } catch (err) {
      console.error('❌ Voice handler error:', (err as Error).message);
      const msg = is429(err) ? MSG_429
                : is413(err) ? MSG_413
                : `❌ No pude procesar el audio. ${(err as Error).message ?? 'Error desconocido'}`;
      try { await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' }); } catch { /* red no disponible */ }
    }
  });

  // Texto libre → detecta contenido sensible automáticamente
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    try {
      const text = msg.text;

      // Comando de ubicación: "Bako, estoy en Madrid"
      const locationMatch = text.match(/^(?:bako[,.]?\s*)?(?:estoy\s+en|me\s+encuentro\s+en|ahora\s+estoy\s+en|estoy\s+ahora\s+en)\s+(.+)$/i);
      if (locationMatch) {
        const loc = locationMatch[1].trim();
        const oldLoc = await getCurrentLocation();
        invalidateCityWeatherCache(oldLoc);
        invalidateCityWeatherCache(loc);
        await saveMemory(`Ubicación actual de Borja: ${loc}`, {
          type: 'fact', importance: 'high', source: 'manual', tags: ['ubicacion', 'ubicacion-actual'],
        });
        await bot.sendMessage(chatId, `📍 Ubicación actualizada: *${loc}*\nConsultaré el tiempo de ${loc} desde ahora.`, { parse_mode: 'Markdown' });
        return;
      }

      // Corrección de datos personales: "eso está mal", "te corrijo", "en realidad", etc.
      const correctionMatch = text.match(
        /^(?:bako[,.]?\s*)?(?:eso\s+est[aá](?:s)?\s+(?:mal|incorrecto)|est[aá]s\s+equivocado|te\s+corrijo[,:]?|dato\s+incorrecto[,:]?|correcci[oó]n[,:]?|(?:no[,.]\s*)?en\s+realidad\s+(?:tengo|soy|tenemos|me\s+llamo|vivo|cumplo|mi|nací))[,.]?\s*(.+)$/i
      );
      if (correctionMatch) {
        const correctedFact = correctionMatch[1].trim();
        await saveMemory(`Corrección de Borja: ${correctedFact}`, {
          type: 'fact', importance: 'high', source: 'manual', tags: ['correccion', 'dato-personal'],
        });
        const reply = `✅ Corregido, señor. Recordaré que ${correctedFact}.`;
        await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        await sendVoiceReply(chatId, `Corregido. Recordaré que ${correctedFact}.`);
        return;
      }

      // Detección de intención → comandos de datos en tiempo real
      const intentCommand = detectDataIntent(text);
      if (intentCommand) {
        await handleCommand(chatId, intentCommand);
        return;
      }

      // Actualización de perfil en lenguaje natural
      const profileUpdate = await detectProfileUpdate(text);
      if (profileUpdate) {
        const result = await updateProfileField(profileUpdate.key, profileUpdate.value, 'conversation');
        if (result.ok) {
          const reply = `✅ Perfil actualizado — ${result.label}: _"${result.current}"_`;
          await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
          await sendVoiceReply(chatId, `Perfil actualizado, señor. ${result.label} registrado como ${result.current}.`);
          return;
        }
      }

      // Recordatorios: "recuérdame en X [que] mensaje"
      if (/^(?:bako[,.]?\s*)?recu[eé]rdame?\s+en\s+/i.test(text)) {
        const reply = await scheduleReminder(chatId, text);
        if (reply) {
          await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
          await sendVoiceReply(chatId, reply.replace(/[✅⏰*#]/g, '').trim());
          return;
        }
      }

      // Cambio de personalidad en lenguaje natural
      const personalityNlMatch = text.match(
        /(?:bako[,.]?\s*)?(?:activa|cambia\s+(?:a|al?\s+modo)|pon(?:te)?\s+(?:en\s+)?(?:modo)?|usa\s+(?:el\s+modo)?)\s*(jarvis|mayordomo|colega)/i
      );
      if (personalityNlMatch) {
        const key = personalityNlMatch[1].toLowerCase();
        const preset = PERSONALIDAD_PRESETS[key];
        if (preset) {
          currentPersonality = preset;
          const reply = `✅ ${preset.nombre} activado, señor.`;
          await bot.sendMessage(chatId, reply);
          await sendVoiceReply(chatId, `${preset.nombre} activado.`);
          return;
        }
      }

      // Cambio de modo LLM en lenguaje natural
      const llmSwitchMatch = text.match(/(?:bako[,.]?\s*)?(?:usa|cambia\s+a|activa|cambia\s+al?\s+modo)\s+(ollama|groq|auto)/i);
      if (llmSwitchMatch) {
        llmMode = llmSwitchMatch[1].toLowerCase() as LlmMode;
        const reply = `✅ Entendido, señor. ${llmModeLabel(llmMode)}.`;
        await bot.sendMessage(chatId, reply);
        await sendVoiceReply(chatId, reply.replace(/[✅☁️🏠🔄]/g, '').trim());
        return;
      }

      // Consulta de servicio activo
      if (/qu[eé]\s+(servicio|modelo|llm|ia)\s+(est[aá]s\s+usando|usas|funciona)|est[aá]s\s+en\s+(local|nube|cloud)|ollama\s+o\s+groq|groq\s+o\s+ollama|desde\s+(d[oó]nde|qu[eé])\s+(est[aá]s|funciona|sirves)/i.test(text)) {
        const ollamaOk = await isOllamaAvailable();
        const reply = ollamaOk
          ? '🏠 Estoy en modo local — Ollama en su PC. Procesamiento privado, sin coste de API.'
          : '☁️ Estoy en modo nube — Groq. Su PC no está disponible o Ollama no responde.';
        await sendVoiceReply(chatId, reply);
        return;
      }

      // Comandos de memoria (antes de cualquier otro procesamiento)
      const rememberMatch = text.match(/^(?:bako[,.]?\s*)?recuerda(?:\s+que)?\s+(.+)$/i);
      if (rememberMatch) {
        await saveMemory(rememberMatch[1].trim(), { importance: 'high', source: 'manual' });
        await bot.sendMessage(chatId, '🧠 Memorizado, señor.');
        return;
      }

      const forgetMatch = text.match(/^(?:bako[,.]?\s*)?olvida(?:\s+(?:que|lo\s+de?))?\s+(.+)$/i);
      if (forgetMatch) {
        const result = await forgetMemory(forgetMatch[1].trim());
        const msg = result === 'deleted'   ? '🧠 Olvidado, señor.'
                  : result === 'protected' ? '🔒 Ese recuerdo forma parte de mi conocimiento base y no puedo borrarlo. Si quiere eliminarlo, indíqueme el ID.'
                  :                          '⚠️ No encontré ese recuerdo.';
        await bot.sendMessage(chatId, msg);
        return;
      }

      // Redactar email / respuesta
      const draftMatch = text.match(/^(?:bako[,.]?\s*)?redacta(?:\s+una?)?\s+(?:respuesta|email|correo|mail)\s+(?:a|para|al?)\s+(.+?)(?:\s+(?:sobre|acerca\s+de|re(?:gardin)?:?)\s+(.+))?$/i);
      if (draftMatch) {
        const destino = draftMatch[1].trim();
        const asunto  = draftMatch[2]?.trim() ?? '';
        await bot.sendMessage(chatId, `✍️ Redactando borrador para ${destino}${asunto ? ` sobre "${asunto}"` : ''}...`);
        try {
          const memoriesSection = await getMemoriesSection(llmMode === 'groq' ? 20 : 5);
          const draftPrompt = `Redacta un email profesional pero cercano.
Destinatario: ${destino}
${asunto ? `Asunto: ${asunto}` : ''}
Remitente: Borja Olazabal (desarrollador fullstack, bohdeveloper.com)
Idioma: español. Tono: directo y profesional. Sin asteriscos ni markdown.
Formato de respuesta: SOLO el cuerpo del email, sin "Asunto:" ni cabeceras.`;
          const cuerpo = await askClaude(draftPrompt, {
            systemPrompt: buildSystemPrompt('', memoriesSection),
          });
          const subjectLine = asunto || `Mensaje de Borja Olazabal`;
          const { draftId } = await createDraft(destino, subjectLine, cuerpo);
          const confirmText = `✅ *Borrador creado en Gmail*\n\nPara: ${destino}\nAsunto: ${subjectLine}\n\n_ID: ${draftId}_\n\nRevíselo en Gmail antes de enviarlo.`;
          await bot.sendMessage(chatId, confirmText, { parse_mode: 'Markdown' });
          await sendVoiceReply(chatId, `Borrador creado para ${destino}. Revíselo en Gmail antes de enviarlo.`);
        } catch {
          await bot.sendMessage(chatId, '⚠️ No pude crear el borrador. Verifique que Gmail esté autorizado.');
        }
        return;
      }

      if (/qu[eé]\s+recuerdas|qu[eé]\s+sabes(?:\s+de\s+m[ií])?|muéstrame\s+(?:tus\s+)?recuerdos/i.test(text)) {
        const memories = await getMemories();
        if (!memories.length) {
          await bot.sendMessage(chatId, '🧠 Aún no tengo recuerdos guardados sobre usted, señor.');
          return;
        }
        let mem = '🧠 *Lo que recuerdo de usted:*\n\n';
        for (const m of memories) {
          const icon  = m.importance === 'high' ? '🔴' : m.importance === 'medium' ? '🟡' : '⚪';
          const fecha = new Date(m.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
          mem += `${icon} ${m.content} _(${fecha})_\n`;
        }
        await bot.sendMessage(chatId, mem, { parse_mode: 'Markdown' });
        return;
      }

      // Detección automática de contenido sensible
      if (isSensitive(text)) {
        const ollamaOk = await isOllamaAvailable();
        if (!ollamaOk) {
          await bot.sendMessage(
            chatId,
            '⚠️ He detectado contenido sensible en tu mensaje.\n\n🔒 Para procesarlo necesito Ollama local, pero no está disponible.\n\nEnciende tu PC y asegúrate de que Ollama está corriendo, o reformula el mensaje sin datos confidenciales.'
          );
          return;
        }
        await bot.sendMessage(chatId, '🔒 Contenido sensible detectado — procesando solo en local...');
        const memoriesSection = await getMemoriesSection(llmMode === 'groq' ? 20 : 5);
        const response = await askClaude(text, {
          systemPrompt: buildSystemPrompt('', memoriesSection),
          private: true,
        });
        await sendVoiceReply(chatId, response);
        // Sin extracción en mensajes sensibles — privacidad
        return;
      }

      // Intenciones de ejecución (crear/modificar Notion, Calendar...)
      const action = await tryExecuteAction(text);
      if (action) {
        await bot.sendMessage(chatId, action.text, { parse_mode: 'Markdown' });
        await sendVoiceReply(chatId, action.voice);
        appendToSession(chatId, text, action.voice);
        return;
      }

      // Contexto ambiental siempre activo: tiempo (ciudad actual), ubicación, agenda, tracker
      const currentLocation = await getCurrentLocation();
      const [memoriesSection, ambientCtx, dynProfile] = await Promise.all([
        getMemoriesSection(llmMode === 'groq' ? 20 : 5),
        getAmbientContext(currentLocation),
        getDynamicProfileSection(),
      ]);

      // Contexto adicional según keywords específicos
      const additionalParts: string[] = [];

      if (/proyecto|repo|commit|github|code|código|PR/i.test(text)) {
        const gh = await fetchGitHubData();
        const repos = gh.repos.slice(0, 3).map(r => r.name).join(', ');
        additionalParts.push(`Proyectos activos: ${repos}`);
        if (gh.recentCommits.length > 0) additionalParts.push(`Commits recientes: ${gh.recentCommits.length}`);
      }

      if (/tracker|actividad|kronoshin|biziki|tarea.*hoy|hoy.*tarea|completad|completar|marcar|registrar|hice|no hice/i.test(text)) {
        const writeMatch   = text.match(/(?:marca|pon|registra|completa|da por completad[ao]|marca como hecha?)\s+(?:la tarea\s+)?(.+?)(?:\s+como\s+(?:completad[ao]|hech[ao]|done|lista?|realizada?))?(?:\s+en tracker)?\.?$/i);
        const notDoneMatch = text.match(/(?:marca|pon|registra)\s+(?:la tarea\s+)?(.+?)\s+como\s+(?:no completad[ao]|no hech[ao]|pendiente|fallid[ao])(?:\s+(?:porque|por|motivo[:]?)\s+(.+))?\.?$/i);

        if (notDoneMatch) {
          const taskName = notDoneMatch[1].trim();
          const reason   = notDoneMatch[2]?.trim();
          const result   = await markTrackerRecord(taskName, false, reason);
          const reply    = result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`;
          await bot.sendMessage(chatId, reply);
          if (result.success) await sendVoiceReply(chatId, result.message);
          appendToSession(chatId, text, result.message);
          return;
        }

        if (writeMatch) {
          const taskName = writeMatch[1].trim();
          const result   = await markTrackerRecord(taskName, true);
          const reply    = result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`;
          await bot.sendMessage(chatId, reply);
          if (result.success) await sendVoiceReply(chatId, result.message);
          appendToSession(chatId, text, result.message);
          return;
        }

        const summary    = await getTrackerSummary();
        const trackerCtx = summary.tasks.map(t => {
          const estado = t.done === true ? 'completada' : t.done === false ? `no completada${t.reason ? ` (${t.reason})` : ''}` : 'pendiente';
          return `${t.name} [${t.time}]: ${estado}`;
        }).join('\n');
        additionalParts.push(`Tracker detallado de hoy (${summary.date}):\n${trackerCtx}`);
        additionalParts.push(`Resumen: ${summary.completedCount} completadas, ${summary.notDoneCount} no hechas, ${summary.pendingCount} pendientes`);
      }

      if (/comentario|blog|post/i.test(text)) {
        const comments = await getBlogComments(false);
        const ctx = comments.length > 0
          ? comments.map(c => `"${c.body}" — ${c.alias} en "${c.post_title}"`).join('\n')
          : 'Sin comentarios todavía.';
        additionalParts.push(`Comentarios del blog:\n${ctx}`);
      }

      const extraContext = ambientCtx + (additionalParts.length > 0 ? `\n\nCONTEXTO ADICIONAL:\n${additionalParts.join('\n')}` : '');
      const conversationHistory = getSessionHistory(chatId);

      const response = await askClaude(text, await resolveLlmOptions({
        systemPrompt: buildSystemPrompt(extraContext, memoriesSection, dynProfile),
        conversationHistory,
      }));
      await sendVoiceReply(chatId, response);
      appendToSession(chatId, text, response);
      extractAndSaveMemories(text, response).catch(() => {});
      const detectedMoodText = detectMoodFromText(text);
      if (detectedMoodText) { currentMood = detectedMoodText; moodMessageCount = 0; }
      else autoShiftMood();
    } catch (err) {
      console.error('❌ Message handler error:', (err as Error).message);
      const msg = is429(err) ? MSG_429
                : is413(err) ? MSG_413
                : `❌ Error: ${(err as Error).message ?? 'Error desconocido'}`;
      try { await bot.sendMessage(chatId, msg); } catch { /* red no disponible */ }
    }
  });

  bot.on('polling_error', (err) => {
    console.error('❌ Telegram polling error:', err.message);
  });
}

export async function sendSystemMessage(text: string, voiceText?: string): Promise<void> {
  const chatId = Number(process.env.TELEGRAM_CHAT_ID);
  if (!chatId) {
    console.warn('⚠️  TELEGRAM_CHAT_ID no definido — ignorando mensaje de sistema');
    return;
  }
  if (!bot) {
    console.warn('⚠️  Bot no iniciado — ignorando mensaje de sistema');
    return;
  }
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  if (voiceText) await sendVoiceReply(chatId, voiceText);
}
