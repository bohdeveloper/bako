import TelegramBot from 'node-telegram-bot-api';
import FormData from 'form-data';
import axios from 'axios';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { getWeather } from './weather';
import { fetchGitHubData } from './github';
import { getNotionTasks, createNotionTask } from './notion';
import { getCalendarEvents, formatEventsForSpeech } from './calendar';
import { getTrackerSummary, formatTrackerForSpeech, markTrackerRecord, getBlogComments, formatCommentsForSpeech, nowInSpain } from './cloudflare';
import { askClaude, isOllamaAvailable, PrivacyError } from '../llm/claude';
import { generateVoiceBuffer } from './tts';
import { BAKO_PROFILE } from '../knowledge/profile';
import { saveMemory, getMemories, formatMemoriesForPrompt, forgetMemory, extractAndSaveMemories } from './memory';
import { tryExecuteAction } from './actions';

function buildSystemPrompt(extraContext = '', memoriesSection = ''): string {
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

  return `Eres BAKO (Borja's Autonomous Knowledge Operator), asistente personal de tu señor.

CONTEXTO ACTUAL:
- Fecha y hora: ${fecha} — ${hora} (hora de España, Europe/Madrid)
- Día: ${diaSemana}
- Situación probable: ${situacion}

REGLAS ESTRICTAS:
1. NUNCA inventes datos que no tienes (emails, reuniones, cifras). Si no hay datos reales, di exactamente: "No tengo datos sobre eso todavía."
2. SÍ puedes razonar con lo que sabes: hora actual, ubicación, rutina, proyectos del perfil.
3. Responde siempre en español, de forma concisa. Máximo 3 frases.
4. Trato: siempre de "señor". Nunca usar el nombre directamente.
${extraContext}
${memoriesSection ? `RECUERDOS DINÁMICOS (complementan o actualizan el perfil base):\n${memoriesSection}\n` : ''}
PERFIL DE TU SEÑOR:
${JSON.stringify(BAKO_PROFILE, null, 2)}`;
}

async function getMemoriesSection(): Promise<string> {
  try {
    const memories = await getMemories();
    return formatMemoriesForPrompt(memories);
  } catch {
    return '';
  }
}

const SENSITIVE_PATTERN = /inetum|contrato|nómina|sueldo|salario|password|contraseña|token|secret|credencial|dni|seguridad social|banco|cuenta corriente|tarjeta/i;

function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERN.test(text);
}

let bot: TelegramBot;

async function sendVoiceReply(chatId: number, text: string): Promise<void> {
  try {
    const buffer = await generateVoiceBuffer(text);
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

// Vocabulario propio inyectado en Whisper para mejorar reconocimiento de nombres
const WHISPER_PROMPT = 'BAKO, Borja, Unyona, Diamadmin, Nitflex, bohdeveloper, Inetum, Errentería, Donostia, Gipuzkoa, BIZIKI, Shaolin, Arramendi, Cloudflare, MongoDB, PostgreSQL, TypeScript, React, Angular, Next.js, Spring Boot, Node.js, GitHub, Notion, Telegram, Render, Groq, Ollama, AlvaroNeural';

// Correcciones para errores fonéticos conocidos (segunda capa de seguridad)
const TRANSCRIPTION_FIXES: Array<[RegExp, string]> = [
  [/\buniona\b/gi,     'Unyona'],
  [/\buniiona\b/gi,    'Unyona'],
  [/\bunyiona\b/gi,    'Unyona'],
  [/\bdia\s+admin\b/gi,'Diamadmin'],
  [/\bdiamadin\b/gi,   'Diamadmin'],
  [/\bnetflix\b/gi,    'Nitflex'],
  [/\bnitflix\b/gi,    'Nitflex'],
  [/\bvako\b/gi,       'BAKO'],
  [/\bbaco\b/gi,       'BAKO'],
  [/\birrentería\b/gi, 'Errentería'],
  [/\berrenterÍa\b/gi, 'Errentería'],
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
      const memoriesSection = await getMemoriesSection();
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
  bot.onText(/^\/(briefing|tiempo|proyectos|tareas|agenda|tracker|comentarios)$/, async (msg, match) => {
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
        return;
      }

      const memoriesSection = await getMemoriesSection();
      const response = await askClaude(transcription, {
        systemPrompt: buildSystemPrompt('', memoriesSection),
        useCloud: true,
      });
      await sendVoiceReply(chatId, response);
      extractAndSaveMemories(transcription, response).catch(() => {});
    } catch (err) {
      await bot.sendMessage(chatId, '❌ No pude procesar el audio.');
    }
  });

  // Texto libre → detecta contenido sensible automáticamente
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    try {
      const text = msg.text;

      // Comandos de memoria (antes de cualquier otro procesamiento)
      const rememberMatch = text.match(/^(?:bako[,.]?\s*)?recuerda(?:\s+que)?\s+(.+)$/i);
      if (rememberMatch) {
        await saveMemory(rememberMatch[1].trim(), { importance: 'high', source: 'manual' });
        await bot.sendMessage(chatId, '🧠 Memorizado, señor.');
        return;
      }

      const forgetMatch = text.match(/^(?:bako[,.]?\s*)?olvida(?:\s+(?:que|lo\s+de?))?\s+(.+)$/i);
      if (forgetMatch) {
        const deleted = await forgetMemory(forgetMatch[1].trim());
        await bot.sendMessage(chatId, deleted ? '🧠 Olvidado, señor.' : '⚠️ No encontré ese recuerdo.');
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
        const memoriesSection = await getMemoriesSection();
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
        return;
      }

      const now = nowInSpain();
      const contextParts: string[] = [
        `Fecha y hora en España: ${now.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`,
      ];

      if (/tiempo|clima|temperatura|lluvia|sol|nublado|mañana|previsión|meteorolog/i.test(text)) {
        const w = await getWeather();
        contextParts.push(`Clima en ${w.city}: ${w.current.temp}°C, ${w.current.description}, viento ${w.current.windSpeed} km/h`);
        w.forecast.forEach(d => contextParts.push(`${d.date}: ${d.minTemp}-${d.maxTemp}°C, ${d.description}, lluvia ${d.rainProbability}%`));
      }

      if (/proyecto|repo|commit|github|code|código|PR/i.test(text)) {
        const gh = await fetchGitHubData();
        const repos = gh.repos.slice(0, 3).map(r => r.name).join(', ');
        contextParts.push(`Proyectos activos: ${repos}`);
        if (gh.recentCommits.length > 0) contextParts.push(`Commits recientes: ${gh.recentCommits.length}`);
      }

      if (/tracker|actividad|kronoshin|biziki|tarea.*hoy|hoy.*tarea|completad|completar|marcar|registrar|hice|no hice/i.test(text)) {
        // Detectar intención de escritura: "marca X como completada/hecha/done"
        const writeMatch = text.match(/(?:marca|pon|registra|completa|da por completad[ao]|marca como hecha?)\s+(?:la tarea\s+)?(.+?)(?:\s+como\s+(?:completad[ao]|hech[ao]|done|lista?|realizada?))?(?:\s+en tracker)?\.?$/i);
        const notDoneMatch = text.match(/(?:marca|pon|registra)\s+(?:la tarea\s+)?(.+?)\s+como\s+(?:no completad[ao]|no hech[ao]|pendiente|fallid[ao])(?:\s+(?:porque|por|motivo[:]?)\s+(.+))?\.?$/i);

        if (notDoneMatch) {
          const taskName = notDoneMatch[1].trim();
          const reason   = notDoneMatch[2]?.trim();
          const result   = await markTrackerRecord(taskName, false, reason);
          await bot.sendMessage(chatId, result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`);
          if (result.success) await sendVoiceReply(chatId, result.message);
          return;
        }

        if (writeMatch) {
          const taskName = writeMatch[1].trim();
          const result   = await markTrackerRecord(taskName, true);
          await bot.sendMessage(chatId, result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`);
          if (result.success) await sendVoiceReply(chatId, result.message);
          return;
        }

        // Solo lectura: inyectar datos del tracker como contexto
        const summary = await getTrackerSummary();
        const trackerCtx = summary.tasks.map(t => {
          const estado = t.done === true ? 'completada' : t.done === false ? `no completada${t.reason ? ` (${t.reason})` : ''}` : 'pendiente';
          return `${t.name} [${t.time}]: ${estado}`;
        }).join('\n');
        contextParts.push(`Tracker de hoy (${summary.date}):\n${trackerCtx}`);
        contextParts.push(`Resumen: ${summary.completedCount} completadas, ${summary.notDoneCount} no hechas, ${summary.pendingCount} pendientes`);
      }

      if (/comentario|blog|post/i.test(text)) {
        const comments = await getBlogComments(false);
        if (comments.length > 0) {
          const ctx = comments.map(c => `"${c.body}" — ${c.alias} en "${c.post_title}"`).join('\n');
          contextParts.push(`Comentarios del blog:\n${ctx}`);
        } else {
          contextParts.push('Blog: sin comentarios todavía.');
        }
      }

      const extraContext = contextParts.length > 1 ? `\nDATOS EN TIEMPO REAL:\n${contextParts.join('\n')}\n\n` : '';

      const memoriesSection = await getMemoriesSection();
      const response = await askClaude(text, {
        systemPrompt: buildSystemPrompt(extraContext, memoriesSection),
        useCloud: true,
      });
      await sendVoiceReply(chatId, response);
      extractAndSaveMemories(text, response).catch(() => {});
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Error al procesar tu mensaje.');
    }
  });

  bot.on('polling_error', (err) => {
    console.error('❌ Telegram polling error:', err.message);
  });
}
