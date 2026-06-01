import TelegramBot from 'node-telegram-bot-api';
import FormData from 'form-data';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { getWeather } from './weather';
import { fetchGitHubData } from './github';
import { askClaude } from '../llm/claude';
import { generateVoiceBuffer } from './tts';

function loadProfile(): string {
  try {
    const profilePath = path.join(__dirname, '../knowledge/profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    return `\n\nPERFIL DE TU SEÑOR:\n${JSON.stringify(profile, null, 2)}`;
  } catch {
    return '';
  }
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
  if (!allowed) return true;
  return String(chatId) === allowed;
}

async function downloadFile(fileId: string): Promise<Buffer> {
  const link = await bot.getFileLink(fileId);
  const { data } = await axios.get(link, { responseType: 'arraybuffer' });
  return Buffer.from(data);
}

async function transcribeAudio(buffer: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', buffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'es');

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
  return data.text as string;
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
    const gh = await fetchGitHubData();
    if (gh.issues.length === 0) {
      await bot.sendMessage(chatId, '✅ No hay tareas pendientes en GitHub.');
      return;
    }
    let text = '📋 *Tareas pendientes:*\n';
    gh.issues.forEach(i => { text += `• [${i.repo}] ${i.title}\n`; });
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
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

  // Comandos
  bot.onText(/^\/(briefing|tiempo|proyectos|tareas)$/, async (msg, match) => {
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

      const response = await askClaude(transcription, {
        systemPrompt: `Eres BAKO, asistente personal de tu señor. Reglas estrictas:
1. NUNCA inventes información. Solo usa los datos del contexto proporcionado.
2. Si no tienes datos reales sobre algo, di exactamente: "No tengo datos sobre eso todavía."
3. Responde siempre en español, de forma concisa. Máximo 3 frases.${loadProfile()}`,
        useCloud: true,
      });
      await sendVoiceReply(chatId, response);
    } catch (err) {
      await bot.sendMessage(chatId, '❌ No pude procesar el audio.');
    }
  });

  // Texto libre → Groq con contexto real según intención
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    try {
      const text = msg.text;
      const contextParts: string[] = [
        `Fecha y hora: ${new Date().toLocaleString('es-ES')}`,
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

      const context = contextParts.length > 1 ? `\nContexto:\n${contextParts.join('\n')}` : '';

      const response = await askClaude(text + context, {
        systemPrompt: `Eres BAKO, asistente personal de tu señor. Reglas estrictas:
1. NUNCA inventes información. Solo usa los datos del contexto proporcionado.
2. Si no tienes datos reales sobre algo (reuniones, tareas, eventos), di exactamente: "No tengo datos sobre eso todavía."
3. Responde siempre en español, de forma concisa. Máximo 3 frases.${loadProfile()}`,
        useCloud: true,
      });
      await sendVoiceReply(chatId, response);
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Error al procesar tu mensaje.');
    }
  });

  bot.on('polling_error', (err) => {
    console.error('❌ Telegram polling error:', err.message);
  });
}
