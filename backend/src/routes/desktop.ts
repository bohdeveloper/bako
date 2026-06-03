/**
 * BAKO Desktop API
 * Endpoints para el cliente de escritorio (Python script, hotkey, etc.)
 *
 * POST /api/desktop/voice  — audio → transcripción → LLM → audio respuesta
 * POST /api/desktop/text   — texto → LLM → texto + audio respuesta
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { askClaude } from '../llm/claude';
import { generateVoiceBuffer } from '../tools/tts';
import { getMemoriesSection, getDynamicProfileSection, buildSystemPrompt } from '../tools/telegram';
import { getAmbientContext } from '../tools/context';
import { getCurrentLocation } from '../tools/memory';
import { tryExecuteAction } from '../tools/actions';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Verificar que la petición viene de local (o con token de escritorio)
function isDesktopAuthorized(req: Request): boolean {
  const token = process.env.DESKTOP_TOKEN;
  if (!token) return true; // si no hay token configurado, permite acceso libre
  return req.headers['x-desktop-token'] === token;
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
    getMemoriesSection(),
    getDynamicProfileSection(),
    getAmbientContext(location),
  ]);
  return buildSystemPrompt(ambientCtx, memories, dynProfile);
}

// POST /api/desktop/voice — audio WAV/OGG → texto + audio respuesta
router.post('/voice', upload.single('audio'), async (req: Request, res: Response) => {
  if (!isDesktopAuthorized(req)) { res.status(401).json({ error: 'No autorizado' }); return; }
  if (!req.file) { res.status(400).json({ error: 'Se requiere campo "audio"' }); return; }

  try {
    const transcription = await transcribeAudio(req.file.buffer);
    if (!transcription.trim()) { res.status(400).json({ error: 'No se detectó habla en el audio' }); return; }

    // Intentar acción directa primero (crear tareas, eventos, etc.)
    const action = await tryExecuteAction(transcription);
    if (action) {
      const audioBuffer = await generateVoiceBuffer(action.voice);
      res.json({
        transcription,
        response: action.text,
        audio: audioBuffer.toString('base64'),
      });
      return;
    }

    // Respuesta conversacional completa con contexto
    const systemPrompt = await getFullSystemPrompt();
    const response = await askClaude(transcription, { systemPrompt, useCloud: true });
    const audioBuffer = await generateVoiceBuffer(response);

    res.json({
      transcription,
      response,
      audio: audioBuffer.toString('base64'),
    });
  } catch (err) {
    console.error('❌ Desktop /voice:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/desktop/text — { "message": "..." } → { response, audio }
router.post('/text', async (req: Request, res: Response) => {
  if (!isDesktopAuthorized(req)) { res.status(401).json({ error: 'No autorizado' }); return; }
  const { message } = req.body;
  if (!message) { res.status(400).json({ error: 'Se requiere campo "message"' }); return; }

  try {
    const action = await tryExecuteAction(message);
    if (action) {
      const audioBuffer = await generateVoiceBuffer(action.voice);
      res.json({ response: action.text, audio: audioBuffer.toString('base64') });
      return;
    }

    const systemPrompt = await getFullSystemPrompt();
    const response = await askClaude(message, { systemPrompt, useCloud: true });
    const audioBuffer = await generateVoiceBuffer(response);

    res.json({ response, audio: audioBuffer.toString('base64') });
  } catch (err) {
    console.error('❌ Desktop /text:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
