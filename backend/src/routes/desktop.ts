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
import { askClaude, askClaudeStream, isOllamaAvailable, classifyQueryComplexity } from '../llm/claude';
import { generateVoiceBuffer, cleanForVoice } from '../tools/tts';
import { getMemoriesSection, getDynamicProfileSection, getPeopleSection, getProjectsSection, getKnowledgeSection, getTasksSection, buildSystemPrompt } from '../tools/telegram';
import { getAmbientContext } from '../tools/context';
import { getCurrentLocation } from '../tools/memory';
import { tryExecuteAction } from '../tools/actions';
import { requireAuth } from '../middleware/authMiddleware';
import { getUnreadEmails, formatEmailsForText } from '../tools/gmail';
import { llmLimiter, validateMessage } from '../middleware/security';

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

/**
 * ¿Ollama es el proveedor por defecto? Hoy NO: medido en el PC de casa
 * (GTX 1650, 4 GB) el prompt compact necesita ~40 s y el mínimo ~15 s, por encima
 * del safety de 25 s — Ollama agotaría su timeout y caería a Groq igualmente,
 * gastando la misma cuota y perdiendo esos segundos por el camino.
 *
 * Con la GPU de 8 GB instalada, activarlo sin tocar código:
 *   LLM_PREFER_LOCAL=true · OLLAMA_MODEL=qwen3:8b · OLLAMA_NUM_CTX=16384
 *
 * Independientemente de esto, el badge de la PWA sí puede forzar Ollama a mano
 * mientras el túnel responda.
 */
const PREFER_LOCAL = /^(1|true|si|sí)$/i.test(process.env.LLM_PREFER_LOCAL ?? '');

// Cache del estado de Ollama — se refresca cada 30s para no añadir latencia
let ollamaCache: { available: boolean; ts: number } = { available: false, ts: 0 };
async function getCachedOllamaStatus(): Promise<boolean> {
  if (Date.now() - ollamaCache.ts < 30_000) return ollamaCache.available;
  const available = await isOllamaAvailable();
  ollamaCache = { available, ts: Date.now() };
  return available;
}

// GET /api/desktop/llm-status — qué LLM usa /text por defecto y si se puede elegir.
// Con el túnel vivo el defecto es Ollama (no gasta cuota de Groq) y el cliente puede
// alternar; si está caído, Groq es la única opción y el badge se bloquea.
router.get('/llm-status', async (_req: Request, res: Response) => {
  const ollama = await getCachedOllamaStatus();
  console.log(`🔍 llm-status: Ollama=${ollama} (URL=${process.env.OLLAMA_URL ?? 'localhost:11434'})`);
  const defaultLocal = ollama && PREFER_LOCAL;
  res.json({
    llm:             defaultLocal ? 'ollama' : 'groq',
    model:           defaultLocal
      ? (process.env.OLLAMA_MODEL ?? 'llama3.2:3b')
      : (process.env.GROQ_MODEL   ?? 'openai/gpt-oss-120b'),
    ollamaAvailable: ollama,
    canChoose:       ollama,
  });
});

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

// Wrapper con timeout para msedge-tts — sin timeout puede colgar indefinidamente
// si los servidores de Microsoft no responden desde la IP de Render
async function safeVoiceBuffer(text: string, timeoutMs = 8000): Promise<Buffer | null> {
  return Promise.race<Buffer | null>([
    generateVoiceBuffer(cleanForVoice(text)).catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
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

// Prompt mínimo para preguntas simples (saludo, hora) → Ollama puede responder en <5s
async function getMinimalSystemPrompt(message = '', clientLocation?: string): Promise<string> {
  const location = clientLocation || await getCurrentLocation();
  const [dynProfile, ambientCtx, emailCtx] = await Promise.all([
    getDynamicProfileSection(),
    getAmbientContext(location),
    getEmailContext(message),
  ]);
  const prompt = buildSystemPrompt(ambientCtx + emailCtx, '', dynProfile, '', '', '');
  console.log(`📊 Desktop prompt (minimal): ${prompt.length} chars`);
  return prompt;
}

async function getFullSystemPrompt(message = '', compact = false, clientLocation?: string): Promise<string> {
  const location = clientLocation || await getCurrentLocation();
  const [memories, dynProfile, ambientCtx, emailCtx, people, projects, knowledge, tasks] = await Promise.all([
    getMemoriesSection(compact ? 2 : 5, 44, compact ? 700 : 1800, message),
    getDynamicProfileSection(),
    getAmbientContext(location),
    getEmailContext(message),
    getPeopleSection(compact ? 5000 : 6000),
    getProjectsSection(compact ? 6000 : 6000),
    getKnowledgeSection(compact ? 4000 : 5500),
    getTasksSection(compact ? 900 : 1200),
  ]);
  const fullAmbient = ambientCtx + emailCtx;
  const prompt = buildSystemPrompt(fullAmbient, memories, dynProfile, people, projects, knowledge, tasks);
  console.log(`📊 Desktop prompt (${compact ? 'compact' : 'full'}): ${prompt.length} chars | people: ${people.length} | projects: ${projects.length} | knowledge: ${knowledge.length} | memories: ${memories.length} | tasks: ${tasks.length}`);
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
router.post('/voice', llmLimiter, upload.single('audio'), async (req: Request, res: Response) => {
  // auth handled by router.use(requireAuth)
  if (!req.file) { res.status(400).json({ error: 'Se requiere campo "audio"' }); return; }

  const safety = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: 'BAKO tardó demasiado. Inténtalo de nuevo.' });
  }, 25_000);

  try {
    const transcription = await transcribeAudio(req.file.buffer);
    if (!transcription.trim()) { res.status(400).json({ error: 'No se detectó habla' }); return; }

    const action = await tryExecuteAction(transcription);
    if (action) {
      const audioBuffer = await safeVoiceBuffer(action.voice);
      res.json({ transcription, response: action.text, audio: audioBuffer?.toString('base64') });
      return;
    }

    const clientLocation = req.body?.location;
    const [ollamaOk, systemPrompt] = await Promise.all([
      getCachedOllamaStatus(),
      getFullSystemPrompt(transcription, true, clientLocation), // always compact — full exceeds Groq 6000 TPM
    ]);
    const useCloud = !(ollamaOk && PREFER_LOCAL);
    const response     = await askClaude(transcription, { systemPrompt, temperature: 0.4, maxTokens: 400, useCloud });
    const audioBuffer  = await safeVoiceBuffer(response);
    res.json({ transcription, response, audio: audioBuffer?.toString('base64') });

  } catch (err) {
    console.error('❌ Desktop /voice:', (err as Error).message);
    if (res.headersSent) return;
    if (isRateLimit(err))        { res.status(429).json({ error: 'Rate limit de Groq alcanzado.', rateLimited: true }); return; }
    if (isContextTooLarge(err))  { res.status(413).json({ error: 'Contexto demasiado grande. Intenta de nuevo.' }); return; }
    res.status(500).json({ error: (err as Error).message });
  } finally {
    clearTimeout(safety);
  }
});

// POST /api/desktop/text
router.post('/text', llmLimiter, validateMessage, async (req: Request, res: Response) => {
  // auth handled by router.use(requireAuth)
  const { message, useCloud: clientUseCloud, location: clientLocation, history: clientHistory } = req.body;
  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> =
    Array.isArray(clientHistory) ? clientHistory.slice(-6) : [];

  // Safety timer: si todo lo demás cuelga, responder antes de que Render corte el TCP (~30s)
  const safety = setTimeout(() => {
    if (!res.headersSent) {
      console.warn('⏱ Desktop /text: safety timeout (25s) — enviando error graceful');
      res.status(504).json({ error: 'BAKO tardó demasiado. Inténtalo de nuevo.' });
    }
  }, 25_000);

  try {
    console.log('🔵 Desktop /text: inicio', JSON.stringify(message).slice(0, 60));
    const action = await tryExecuteAction(message);
    if (action) {
      const audioBuffer = await safeVoiceBuffer(action.voice);
      res.json({ response: action.text, audio: audioBuffer?.toString('base64') });
      return;
    }

    // El prompt mínimo (~5,8k chars) se procesa mucho más rápido que el compact
    // (~16k). En Ollama esa diferencia son decenas de segundos, así que la
    // clasificación se aplica con cualquier proveedor, no solo con Groq.
    const complexity       = classifyQueryComplexity(message);
    const useMinimalPrompt = complexity === 'simple';

    // El sondeo de Ollama tarda hasta 6 s si el túnel está caído, así que va en
    // paralelo con la construcción del prompt (que también consulta Mongo) en vez
    // de sumarse a ella.
    const [ollamaOk, systemPrompt] = await Promise.all([
      getCachedOllamaStatus(),
      useMinimalPrompt
        ? getMinimalSystemPrompt(message, clientLocation)
        : getFullSystemPrompt(message, true, clientLocation), // always compact — full (18104 chars) always exceeds Groq 6000 TPM
    ]);

    // Sin túnel solo hay Groq y se ignora lo que pida el cliente. Con túnel manda
    // la elección explícita del badge; si no la hay, decide PREFER_LOCAL.
    const useCloud = !ollamaOk
      ? true
      : typeof clientUseCloud === 'boolean' ? clientUseCloud : !PREFER_LOCAL;
    console.log(`🔵 Desktop /text: '${complexity}' → ${useCloud ? 'Groq ☁️' : 'Ollama 🏠'} + prompt ${useMinimalPrompt ? 'minimal' : 'full'} (${systemPrompt.length} chars)`);
    const response     = await askClaude(message, { systemPrompt, temperature: 0.4, maxTokens: 400, useCloud, conversationHistory });
    console.log(`🔵 Desktop /text: respuesta LLM OK (${response.length} chars)`);
    const audioBuffer  = await safeVoiceBuffer(response);
    res.json({ response, audio: audioBuffer?.toString('base64') });

  } catch (err) {
    const e = err as any;
    console.error('❌ Desktop /text:', e?.response?.status, e?.response?.data ?? e?.message);
    if (res.headersSent) return;
    if (isRateLimit(err))        { res.status(429).json({ error: 'Rate limit de Groq alcanzado.', rateLimited: true }); return; }
    if (isContextTooLarge(err))  { res.status(413).json({ error: 'Contexto demasiado grande. Intenta de nuevo.' }); return; }
    res.status(500).json({ error: (err as Error).message });
  } finally {
    clearTimeout(safety);
  }
});

// POST /api/desktop/stream — SSE: texto aparece letra a letra en el cliente
router.post('/stream', llmLimiter, validateMessage, async (req: Request, res: Response) => {
  const { message } = req.body;

  try {
    // Todo el trabajo previo antes de abrir el stream (permite devolver errores HTTP reales)
    const action       = await tryExecuteAction(message);
    const systemPrompt = action ? '' : await getFullSystemPrompt(message, true);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (action) {
      res.write(`data: ${JSON.stringify({ chunk: action.text })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Desktop usa Groq (rápido, ~1s TTFT). Ollama queda para Telegram /privado.
    let fullText = '';
    for await (const chunk of askClaudeStream(message, { systemPrompt, temperature: 0.4, maxTokens: 400, useCloud: true })) {
      fullText += chunk;
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }

    // Generar audio TTS y enviarlo como evento final
    try {
      const audioBuffer = await generateVoiceBuffer(cleanForVoice(fullText));
      res.write(`data: ${JSON.stringify({ audio: audioBuffer.toString('base64') })}\n\n`);
    } catch { /* TTS opcional — no bloquea */ }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('❌ Desktop /stream:', (err as Error).message);
    if (!res.headersSent) {
      if (isRateLimit(err))       { res.status(429).json({ error: 'Rate limit de Groq alcanzado.', rateLimited: true }); return; }
      if (isContextTooLarge(err)) { res.status(413).json({ error: 'Contexto demasiado grande. Intenta de nuevo.' }); return; }
      res.status(500).json({ error: (err as Error).message }); return;
    }
    res.write(`data: ${JSON.stringify({ error: 'Error generando respuesta' })}\n\n`);
    res.end();
  }
});

export default router;
