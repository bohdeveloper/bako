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
import { getMemoriesSection, getDynamicProfileSection, buildSystemPrompt } from '../tools/telegram';
import { getAmbientContext } from '../tools/context';
import { getCurrentLocation } from '../tools/memory';
import { tryExecuteAction } from '../tools/actions';
import { requireAuth } from '../middleware/authMiddleware';

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

async function getFullSystemPrompt(): Promise<string> {
  const location = await getCurrentLocation();
  const [memories, dynProfile, ambientCtx] = await Promise.all([
    getMemoriesSection(5, 44, 1800),
    getDynamicProfileSection(),
    getAmbientContext(location),
  ]);
  const prompt = buildSystemPrompt(ambientCtx, memories, dynProfile);
  console.log(`📊 Desktop system prompt: ${prompt.length} chars | memories: ${memories.length} chars`);
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

    const systemPrompt = await getFullSystemPrompt();
    const response     = await askClaude(transcription, { systemPrompt, useCloud: true });
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

    const systemPrompt = await getFullSystemPrompt();
    const response     = await askClaude(message, { systemPrompt, useCloud: true });
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
