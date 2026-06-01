import TelegramBot from 'node-telegram-bot-api';
import FormData from 'form-data';
import axios from 'axios';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { getWeather } from './weather';
import { fetchGitHubData } from './github';
import { askClaude } from '../llm/claude';

let bot: TelegramBot;

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
    await bot.sendMessage(chatId, briefing);
    return;
  }

  if (command === '/tiempo') {
    const w = await getWeather();
    await bot.sendMessage(
      chatId,
      `🌤 *${w.city}*: ${w.current.temp}°C, ${w.current.description}\nViento: ${w.current.windSpeed} km/h · Humedad: ${w.current.humidity}%\nMañana: ${w.forecast[1]?.minTemp}–${w.forecast[1]?.maxTemp}°C, ${w.forecast[1]?.description}`,
      { parse_mode: 'Markdown' }
    );
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
        systemPrompt: 'Eres BAKO, asistente personal de un developer. Responde en español, de forma concisa. Máximo 3 frases.',
      });
      await bot.sendMessage(chatId, response);
    } catch (err) {
      await bot.sendMessage(chatId, '❌ No pude procesar el audio.');
    }
  });

  // Texto libre → LLM
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    try {
      const response = await askClaude(msg.text, {
        systemPrompt: 'Eres BAKO, asistente personal de un developer. Responde en español, de forma directa y concisa. Máximo 3 frases.',
      });
      await bot.sendMessage(chatId, response);
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Error al procesar tu mensaje.');
    }
  });

  bot.on('polling_error', (err) => {
    console.error('❌ Telegram polling error:', err.message);
  });
}
