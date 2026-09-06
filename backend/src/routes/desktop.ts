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
import { isOllamaAvailableCached, classifyQueryComplexity } from '../llm/claude';
import { generateVoiceBuffer, cleanForVoice, VOCES_DISPONIBLES, getCurrentVoiceKey, setVoice } from '../tools/tts';
import { getMemoriesSection, getDynamicProfileSection, getPeopleSection, getProjectsSection, getKnowledgeSection, getTasksSection, buildSystemPrompt } from '../tools/telegram';
import { getAmbientContext } from '../tools/context';
import { getCurrentLocation } from '../tools/memory';
import { runAgentTurn } from '../tools/agent';
import { requireAuth } from '../middleware/authMiddleware';
import { getUnreadEmails, formatEmailsForText } from '../tools/gmail';
import { llmLimiter, validateMessage, generalLimiter } from '../middleware/security';

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

/**
 * `useCloud` llega como booleano por JSON (/text) pero como string por
 * multipart/form-data (/voice, que va con multer) — comprobar solo `typeof ===
 * 'boolean'` haría que la elección del badge se ignorara en el flujo de voz.
 */
function parseBoolField(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true')  return true;
  if (v === 'false') return false;
  return undefined;
}

function isContextTooLarge(err: unknown): boolean {
  const e = err as any;
  return (
    e?.response?.status === 413 ||
    String(e?.message ?? '').includes('413')
  );
}

/**
 * ¿Ollama es el proveedor por defecto? Desde el 05/09/2026, sí: con la AMD
 * RX 7600 de 8 GB, qwen3:8b responde en 0,6 s con el modelo caliente (14,8 s en
 * frío), muy por debajo del safety de 25 s. `LLM_PREFER_LOCAL=true` en Render.
 *
 * Independientemente de esto, el badge de la PWA puede forzar Groq a mano.
 */
const PREFER_LOCAL = /^(1|true|si|sí)$/i.test(process.env.LLM_PREFER_LOCAL ?? '');

// El sondeo cacheado vive en llm/claude.ts: lo comparten el badge de la PWA y la
// construcción del prompt (que necesita saber qué proveedor responderá de verdad),
// y tener dos cachés independientes significaba sondear el túnel el doble.
const getCachedOllamaStatus = isOllamaAvailableCached;

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

// GET /api/desktop/voice-config — voz TTS actual y catálogo disponible.
// OJO: no "voice" a secas — esa ruta ya existe más abajo (audio → LLM → audio).
router.get('/voice-config', generalLimiter, async (_req: Request, res: Response) => {
  const current = await getCurrentVoiceKey();
  res.json({
    current,
    voices: Object.entries(VOCES_DISPONIBLES).map(([key, v]) => ({ key, ...v })),
  });
});

// POST /api/desktop/voice-config { key } — cambia la voz, persistida en Mongo (AutoConfig)
router.post('/voice-config', generalLimiter, async (req: Request, res: Response) => {
  try {
    const key = String(req.body?.key ?? '');
    const ok = await setVoice(key);
    if (!ok) { res.status(400).json({ error: 'Voz no reconocida.' }); return; }
    res.json({ current: key });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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

    const clientLocation = req.body?.location;
    const [ollamaOk, systemPrompt] = await Promise.all([
      getCachedOllamaStatus(),
      getFullSystemPrompt(transcription, true, clientLocation), // always compact — full exceeds Groq 6000 TPM
    ]);
    // Misma regla que /text: sin túnel solo hay Groq; con túnel manda la elección
    // explícita del cliente (el badge) y, si no la hay, decide LLM_PREFER_LOCAL.
    // Antes este endpoint ignoraba la elección del cliente y solo miraba
    // PREFER_LOCAL, así que el botón no gobernaba la voz.
    const clientUseCloud = parseBoolField(req.body?.useCloud);
    const useCloud = !ollamaOk
      ? true
      : clientUseCloud ?? !PREFER_LOCAL;
    const confirmKey = `desktop:${req.authUser!.userId}`;
    const turn = await runAgentTurn(transcription, confirmKey, { systemPrompt, temperature: 0.4, maxTokens: 400, useCloud });
    const audioBuffer  = await safeVoiceBuffer(turn.voice);
    res.json({ transcription, response: turn.text, audio: audioBuffer?.toString('base64') });

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
      : parseBoolField(clientUseCloud) ?? !PREFER_LOCAL;
    console.log(`🔵 Desktop /text: '${complexity}' → ${useCloud ? 'Groq ☁️' : 'Ollama 🏠'} + prompt ${useMinimalPrompt ? 'minimal' : 'full'} (${systemPrompt.length} chars)`);
    const confirmKey = `desktop:${req.authUser!.userId}`;
    const turn = await runAgentTurn(message, confirmKey, { systemPrompt, temperature: 0.4, maxTokens: 400, useCloud, conversationHistory });
    console.log(`🔵 Desktop /text: respuesta LLM OK (${turn.text.length} chars, herramienta: ${turn.toolUsed ?? 'ninguna'})`);
    const audioBuffer  = await safeVoiceBuffer(turn.voice);
    res.json({ response: turn.text, audio: audioBuffer?.toString('base64') });

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
    // NOTA (05/09/2026): endpoint sin uso real por ningún cliente (PWA/Desktop
    // usan /text) — se mantiene funcional pero ya no hace streaming token a
    // token. Combinar tool-calling con streaming real exige reensamblar los
    // fragmentos de `tool_calls` a través de los deltas del SSE del proveedor
    // (Groq y Ollama lo soportan, pero duplica la complejidad); mientras nadie
    // lo consuma no compensa. Si se retoma este endpoint, hacerlo entonces.
    const confirmKey   = `desktop:${req.authUser!.userId}`;
    const systemPrompt = await getFullSystemPrompt(message, true);
    const turn         = await runAgentTurn(message, confirmKey, { systemPrompt, temperature: 0.4, maxTokens: 400, useCloud: true });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ chunk: turn.text })}\n\n`);

    // Generar audio TTS y enviarlo como evento final
    try {
      const audioBuffer = await generateVoiceBuffer(cleanForVoice(turn.text));
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
