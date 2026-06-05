/**
 * BAKO Desktop API
 * POST /api/desktop/transcribe — audio → solo transcripción (sin LLM)
 * POST /api/desktop/voice     — audio → transcripción → LLM → audio respuesta
 * POST /api/desktop/text      — texto → LLM → texto + audio respuesta
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { askClaude } from '../llm/claude';
import { generateVoiceBuffer, cleanForVoice } from '../tools/tts';
import { getMemoriesSection, getDynamicProfileSection, getPeopleSection, buildSystemPrompt } from '../tools/telegram';
import { getAmbientContext } from '../tools/context';
import { getCurrentLocation } from '../tools/memory';
import { tryExecuteAction } from '../tools/actions';
import { requireAuth } from '../middleware/authMiddleware';
import { getUnreadEmails, formatEmailsForText } from '../tools/gmail';

// Detecta cualquier mención a emails/correo — basta con que aparezca la palabra
const EMAIL_REGEX = /\b(emails?|correos?(\s+electr[oó]nicos?)?|mails?|bandeja|gmail)\b/i;

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Todas las rutas desktop requieren auth (JWT o x-desktop-token legacy)
router.use(requireAuth);

function isRateLimit(err: unknown): boolean {
  const e = err as any;
  return (
    e?.response?.status === 429 ||
    String(e?.message ?? '').includes('429') ||
    String(e?.response?.data?.error?.message ?? '').toLowerCase().includes('rate limit')
  );
}

function isContextTooLarge(err: unknown): boolean {
  const e = err as any;
  return (
    e?.response?.status === 413 ||
    String(e?.message ?? '').includes('413')
  );
}

async function transcribeAudio(buffer: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', buffer, { filename: 'voice.wav', contentType: 'audio/wav' });
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'es');
  form.append('prompt', 'BAKO, Yaimy, Yosiel, Kronoshin, Diamadmin, Unyona, BIZIKI, Shaolin, Galicia');

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    form,
    { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
  );
  return data.text as string;
}

async function getEmailContext(message: string): Promise<string> {
  if (!EMAIL_REGEX.test(message)) return '';
  try {
    const emails = await getUnreadEmails(15);
    if (!emails.length) return '\nEMAILS SIN LEER: Bandeja vacía — no hay ningún correo sin leer en este momento.';
    return `\nEMAILS SIN LEER (datos reales, ahora mismo):\n${formatEmailsForText(emails)}`;
  } catch (e) {
    console.warn('⚠️ Gmail no disponible en desktop:', (e as Error).message);
    return '\nEMAILS: No se pudo conectar con Gmail en este momento.';
  }
}

async function getFullSystemPrompt(message = ''): Promise<string> {
  const location = await getCurrentLocation();
  const [memories, dynProfile, ambientCtx, emailCtx, people] = await Promise.all([
    getMemoriesSection(5, 44, 1800),
    getDynamicProfileSection(),
    getAmbientContext(location),
    getEmailContext(message),
    getPeopleSection(),
  ]);
  const fullAmbient = ambientCtx + emailCtx;
  const prompt = buildSystemPrompt(fullAmbient, memories, dynProfile, people);
  console.log(`📊 Desktop prompt: ${prompt.length} chars | people: ${people.length} chars | memories: ${memories.length} chars`);
  return prompt;
}

// POST /api/desktop/transcribe
router.post('/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  // auth handled by router.use(requireAuth)
  if (!req.file) { res.status(400).json({ error: 'Se requiere campo "audio"' }); return; }
  try {
    const transcription = await transcribeAudio(req.file.buffer);
    if (!transcription.trim()) { res.status(400).json({ error: 'No se detectó habla' }); return; }
    res.json({ transcription });
  } catch (err) {
    if (isRateLimit(err))        { res.status(429).json({ error: 'Rate limit de Groq alcanzado. Espera unos segundos.', rateLimited: true }); return; }
    if (isContextTooLarge(err))  { res.status(413).json({ error: 'Contexto demasiado grande. Intenta de nuevo en un momento.' }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/desktop/voice
router.post('/voice', upload.single('audio'), async (req: Request, res: Response) => {
  // auth handled by router.use(requireAuth)
  if (!req.file) { res.status(400).json({ error: 'Se requiere campo "audio"' }); return; }

  try {
    const transcription = await transcribeAudio(req.file.buffer);
    if (!transcription.trim()) { res.status(400).json({ error: 'No se detectó habla' }); return; }

    const action = await tryExecuteAction(transcription);
    if (action) {
      const audioBuffer = await generateVoiceBuffer(cleanForVoice(action.voice));
      res.json({ transcription, response: action.text, audio: audioBuffer.toString('base64') });
      return;
    }

    const systemPrompt = await getFullSystemPrompt(transcription);
    const response     = await askClaude(transcription, { systemPrompt, useCloud: true, temperature: 0.4, maxTokens: 400 });
    const audioBuffer  = await generateVoiceBuffer(cleanForVoice(response));
    res.json({ transcription, response, audio: audioBuffer.toString('base64') });

  } catch (err) {
    console.error('❌ Desktop /voice:', (err as Error).message);
    if (isRateLimit(err))        { res.status(429).json({ error: 'Rate limit de Groq alcanzado.', rateLimited: true }); return; }
    if (isContextTooLarge(err))  { res.status(413).json({ error: 'Contexto demasiado grande. Intenta de nuevo.' }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/desktop/text
router.post('/text', async (req: Request, res: Response) => {
  // auth handled by router.use(requireAuth)
  const { message } = req.body;
  if (!message) { res.status(400).json({ error: 'Se requiere campo "message"' }); return; }

  try {
    const action = await tryExecuteAction(message);
    if (action) {
      const audioBuffer = await generateVoiceBuffer(cleanForVoice(action.voice));
      res.json({ response: action.text, audio: audioBuffer.toString('base64') });
      return;
    }

    const systemPrompt = await getFullSystemPrompt(message);
    const response     = await askClaude(message, { systemPrompt, useCloud: true, temperature: 0.4, maxTokens: 400 });
    const audioBuffer  = await generateVoiceBuffer(cleanForVoice(response));
    res.json({ response, audio: audioBuffer.toString('base64') });

  } catch (err) {
    const e = err as any;
    console.error('❌ Desktop /text:', e?.response?.status, e?.response?.data ?? e?.message);
    if (isRateLimit(err))        { res.status(429).json({ error: 'Rate limit de Groq alcanzado.', rateLimited: true }); return; }
    if (isContextTooLarge(err))  { res.status(413).json({ error: 'Contexto demasiado grande. Intenta de nuevo.' }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
