import axios from 'axios';
import { ollamaHeaders } from './ollamaAuth';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
// Medido en el PC de casa el 05/09/2026, ya con la AMD RX 7600 de 8 GB (ROCm, no
// CUDA), con un prompt real de 7.695 tokens: qwen3:8b responde en 0,6 s con el
// modelo caliente y 14,8 s si hay que cargarlo. En la GTX 1650 anterior eran 85 s.
// Ya cabe de sobra, así que qwen3:8b pasa a ser el defecto.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:8b';
const GROQ_MODEL   = process.env.GROQ_MODEL   ?? 'openai/gpt-oss-120b';

// Una variable declarada pero vacía daría 0 — y axios entiende timeout 0 como
// "sin límite", que colgaría la petición para siempre. Solo vale un número > 0.
function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// 8192 es el punto óptimo en la RX 7600, y no por falta de VRAM: medido con
// qwen3:8b, de 8192 a 12288 la generación se desploma de 37,5 a 5,4 tokens/s
// aunque `ollama ps` siga diciendo 100 % GPU. Subirlo a 16384 no aporta contexto
// útil y multiplica por 6 el tiempo de respuesta.
const OLLAMA_NUM_CTX = envNumber('OLLAMA_NUM_CTX', 8192);

// Cuánto se queda el modelo residente en VRAM tras responder. Con el modelo
// caliente se responde en 0,6 s; cargarlo cuesta 14,8 s. El coste de tenerlo
// residente es ~7 GB de VRAM ocupados en el PC, así que 30m es el equilibrio:
// aguanta una conversación entera y libera la GPU si se deja de usar.
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? '30m';

// Debe quedar por debajo del safety timeout de los endpoints desktop (25 s), para
// que dé tiempo a caer a Groq y responder algo en lugar de un 504. Antes eran 12 s,
// por debajo de los 14,8 s que cuesta cargar el modelo en frío: la primera pregunta
// tras un rato sin usar a BAKO se iba siempre a Groq aunque el PC estuviera encendido.
const OLLAMA_TIMEOUT_MS = envNumber('OLLAMA_TIMEOUT_MS', 18000);

// qwen3 razona en voz alta por defecto y devuelve el razonamiento dentro de
// <think>…</think>. Se desactiva por API (`think:false`, Ollama 0.9+) y además se
// limpia la respuesta, por si el modelo de turno ignora el flag.
function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Si num_predict corta la respuesta a mitad del razonamiento, el <think> se
    // queda sin cerrar: se descarta hasta el final o acabaría leído en voz alta.
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

export interface AskClaudeOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number; // 0.0–1.0 · default 0.4 para respuestas precisas
  useCloud?: boolean;
  private?: boolean;    // true → solo Ollama local, nunca Groq
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class PrivacyError extends Error {
  constructor() {
    super('Ollama local no está disponible. La tarea está marcada como privada y no puede enviarse a la nube.');
    this.name = 'PrivacyError';
  }
}

async function askOllama(messages: Message[], maxTokens?: number, temperature?: number, numCtx = OLLAMA_NUM_CTX): Promise<string> {
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    think: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    options: {
      num_ctx: numCtx,
      ...(maxTokens   ? { num_predict: maxTokens }   : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    },
  }, { timeout: OLLAMA_TIMEOUT_MS, headers: ollamaHeaders() });
  const content = stripThinking(data.message?.content ?? '');
  return content || 'Sin respuesta';
}

async function askGroq(messages: Message[], maxTokens?: number, temperature?: number): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY no está definido en .env');

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      messages,
      ...(maxTokens   ? { max_tokens: maxTokens }   : {}),
      temperature: temperature ?? 0.4,  // default 0.4 — preciso sin ser robótico
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    }
  );
  return data.choices[0]?.message?.content ?? 'Sin respuesta';
}

// Cadena de modelos free de OpenRouter — se prueba en orden hasta que uno responda
const OPENROUTER_FALLBACK_MODELS = [
  process.env.OPENROUTER_MODEL ?? 'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'moonshotai/kimi-k2.6:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

function isOpenRouterModelUnavailable(err: unknown): boolean {
  const status = (err as any)?.response?.status;
  const msg    = String((err as any)?.response?.data?.error?.message ?? '');
  return status === 404 || msg.includes('unavailable') || msg.includes('No endpoints found');
}

async function askOpenRouter(messages: Message[], maxTokens?: number, temperature?: number): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY no definido');

  let lastErr: unknown;
  for (const model of OPENROUTER_FALLBACK_MODELS) {
    try {
      const { data } = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          temperature: temperature ?? 0.4,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai-personal-os.onrender.com',
            'X-Title': 'BAKO Personal OS',
          },
          timeout: 20_000,
        }
      );
      console.log(`⚡ BAKO: OpenRouter respondió con ${model}`);
      return data.choices[0]?.message?.content ?? 'Sin respuesta';
    } catch (err) {
      if (isOpenRouterModelUnavailable(err)) {
        console.warn(`⚡ BAKO: OpenRouter ${model} no disponible → probando siguiente...`);
        lastErr = err;
        continue;
      }
      throw err; // error distinto a 404 (rate limit, auth, etc.) — propagar
    }
  }
  throw lastErr;
}

function isGroqRateLimit(err: unknown): boolean {
  const e = err as any;
  const status = e?.response?.status;
  // 429 = rate limit over time; 413 = single request too large for TPM quota
  return status === 429 || status === 413 ||
    String(e?.message ?? '').includes('429') ||
    String(e?.message ?? '').includes('413');
}

// ── Streaming ─────────────────────────────────────────────────────────────

async function* streamOllama(messages: Message[], maxTokens?: number, temperature?: number): AsyncGenerator<string> {
  const response = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    { model: OLLAMA_MODEL, messages, stream: true, think: false, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_ctx: OLLAMA_NUM_CTX, ...(maxTokens ? { num_predict: maxTokens } : {}), ...(temperature !== undefined ? { temperature } : {}) } },
    { responseType: 'stream', timeout: 60000, headers: ollamaHeaders() }
  );
  let buf = '';
  for await (const raw of response.data as AsyncIterable<Buffer>) {
    buf += raw.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) yield obj.message.content as string;
        if (obj.done) return;
      } catch { /* skip */ }
    }
  }
}

async function* streamGroq(messages: Message[], maxTokens?: number, temperature?: number): AsyncGenerator<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY no definido');
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    { model: GROQ_MODEL, messages, stream: true, ...(maxTokens ? { max_tokens: maxTokens } : {}), temperature: temperature ?? 0.4 },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, responseType: 'stream', timeout: 60000 }
  );
  let buf = '';
  for await (const raw of response.data as AsyncIterable<Buffer>) {
    buf += raw.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const payload = t.slice(6);
      if (payload === '[DONE]') return;
      try {
        const obj = JSON.parse(payload);
        const content = obj.choices?.[0]?.delta?.content as string | undefined;
        if (content) yield content;
      } catch { /* skip */ }
    }
  }
}

export async function* askClaudeStream(
  prompt: string,
  options: AskClaudeOptions = {}
): AsyncGenerator<string> {
  const { systemPrompt, maxTokens, temperature, useCloud = false, private: isPrivate = false, conversationHistory } = options;
  const messages: Message[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (conversationHistory?.length) for (const m of conversationHistory) messages.push({ role: m.role, content: m.content });
  messages.push({ role: 'user', content: prompt });

  if (isPrivate) { yield* streamOllama(messages, maxTokens, temperature); console.log('🔒 BAKO stream: Ollama privado'); return; }
  if (useCloud)  { yield* streamGroq(messages, maxTokens, temperature);   console.log('☁️  BAKO stream: Groq');         return; }

  try {
    yield* streamOllama(messages, maxTokens, temperature);
    console.log('🏠 BAKO stream: Ollama (local)');
  } catch {
    console.warn('⚠️  Ollama stream no disponible → Groq...');
    yield* streamGroq(messages, maxTokens, temperature);
    console.log('☁️  BAKO stream: Groq (fallback)');
  }
}

// El motivo del fallo se registra a propósito: mientras se tragaba en silencio,
// "Ollama no disponible" tapaba por igual el túnel caído, un 403 de Cloudflare,
// un timeout o un DNS que no resuelve — y cada uno se arregla de forma distinta.
// El 403 de Cloudflare a los datacenters costó una sesión entera de diagnóstico.
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 6000, headers: ollamaHeaders() });
    return true;
  } catch (err) {
    const e = err as any;
    const motivo = [e?.code, e?.response?.status, e?.message].filter(Boolean).join(' · ');
    console.warn(`⚠️  Ollama no responde en ${OLLAMA_URL} → ${motivo || 'motivo desconocido'}`);
    return false;
  }
}

// ── Tool-calling (B0 del plan) ──────────────────────────────────────────────
// Formato de herramienta compatible con OpenAI (Groq lo replica tal cual) y con
// Ollama ≥0.9 (el mismo array `tools`, ambos modelos en uso — gpt-oss-120b y
// qwen3:8b — lo soportan de forma nativa).

export interface ToolCall {
  name:      string;
  arguments: Record<string, any>;
}

export interface ToolCallResponse {
  text:      string;                            // respuesta en texto normal, si no llamó a ninguna herramienta
  toolCall?: ToolCall;                           // herramienta elegida por el modelo, si la hay
  provider:  'ollama' | 'groq' | 'openrouter';   // quién respondió de verdad — puede no ser el `useCloud` pedido, si hubo fallback
}

interface RawToolMessage {
  content?:    string;
  tool_calls?: Array<{ function?: { name: string; arguments: string | Record<string, any> }; name?: string; arguments?: string | Record<string, any> }>;
}

// Ollama entrega `arguments` ya como objeto; Groq (API OpenAI) lo entrega como
// string JSON — hay que soportar ambas formas.
function parseToolCall(message: RawToolMessage): ToolCall | undefined {
  const raw = message.tool_calls?.[0];
  if (!raw) return undefined;
  const name = raw.function?.name ?? raw.name;
  if (!name) return undefined;
  let args = raw.function?.arguments ?? raw.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  return { name, arguments: (args as Record<string, any>) ?? {} };
}

async function chatOllamaWithTools(messages: Message[], tools: object[], maxTokens?: number, temperature?: number, numCtx = OLLAMA_NUM_CTX): Promise<RawToolMessage> {
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages,
    tools,
    stream: false,
    think: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    options: {
      num_ctx: numCtx,
      ...(maxTokens   ? { num_predict: maxTokens }   : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    },
  }, { timeout: OLLAMA_TIMEOUT_MS, headers: ollamaHeaders() });
  return data.message ?? {};
}

async function chatGroqWithTools(messages: Message[], tools: object[], maxTokens?: number, temperature?: number): Promise<RawToolMessage> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY no está definido en .env');

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      ...(maxTokens   ? { max_tokens: maxTokens }   : {}),
      temperature: temperature ?? 0.4,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 15_000,
    }
  );
  return data.choices[0]?.message ?? {};
}

// Una sola llamada decide, con el mismo contexto de siempre, si BAKO conversa o
// actúa — sustituye al patrón antiguo de "regex + segunda llamada de extracción"
// (no dobla el número de peticiones al LLM por mensaje). Cadena de resiliencia
// igual que `askClaude` (Ollama → Groq → OpenRouter en 429), con una diferencia
// importante: si toca OpenRouter, va SIN herramientas — los modelos gratuitos de
// ese catálogo no tienen tool-calling fiable, así que en ese escalón BAKO
// degrada a conversación pura en vez de arriesgarse a alucinar una acción.
export async function askClaudeWithTools(
  prompt: string,
  tools: object[],
  options: AskClaudeOptions = {}
): Promise<ToolCallResponse> {
  const { systemPrompt, maxTokens, temperature, useCloud = false, private: isPrivate = false, conversationHistory } = options;

  const messages: Message[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (conversationHistory?.length) {
    for (const m of conversationHistory) messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: prompt });

  if (isPrivate) {
    try {
      const message = await chatOllamaWithTools(messages, tools, maxTokens, temperature);
      return { text: stripThinking(message.content ?? ''), toolCall: parseToolCall(message), provider: 'ollama' };
    } catch {
      throw new PrivacyError();
    }
  }

  async function viaOpenRouterFallback(): Promise<ToolCallResponse> {
    const text = await askOpenRouter(messages, maxTokens, temperature);
    return { text, provider: 'openrouter' }; // sin toolCall — ver nota arriba
  }

  if (useCloud) {
    try {
      const message = await chatGroqWithTools(messages, tools, maxTokens, temperature);
      return { text: stripThinking(message.content ?? ''), toolCall: parseToolCall(message), provider: 'groq' };
    } catch (err) {
      if (isGroqRateLimit(err) && process.env.OPENROUTER_API_KEY) return viaOpenRouterFallback();
      throw err;
    }
  }

  try {
    const message = await chatOllamaWithTools(messages, tools, maxTokens, temperature);
    return { text: stripThinking(message.content ?? ''), toolCall: parseToolCall(message), provider: 'ollama' };
  } catch {
    try {
      const message = await chatGroqWithTools(messages, tools, maxTokens, temperature);
      return { text: stripThinking(message.content ?? ''), toolCall: parseToolCall(message), provider: 'groq' };
    } catch (groqErr) {
      if (isGroqRateLimit(groqErr) && process.env.OPENROUTER_API_KEY) return viaOpenRouterFallback();
      throw groqErr;
    }
  }
}

export async function askClaude(prompt: string, options: AskClaudeOptions = {}): Promise<string> {
  const { systemPrompt, maxTokens, temperature, useCloud = false, private: isPrivate = false, conversationHistory } = options;

  const messages: Message[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (conversationHistory?.length) {
    for (const m of conversationHistory) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: prompt });

  if (isPrivate) {
    try {
      const response = await askOllama(messages, maxTokens, temperature);
      console.log('🔒 BAKO: modo privado → Ollama local');
      return response;
    } catch {
      throw new PrivacyError();
    }
  }

  if (useCloud) {
    try {
      const response = await askGroq(messages, maxTokens, temperature);
      console.log(`☁️  BAKO: Groq (temp=${temperature ?? 0.4})`);
      return response;
    } catch (err) {
      if (isGroqRateLimit(err) && process.env.OPENROUTER_API_KEY) {
        console.warn('⚡ BAKO: Groq rate limited → OpenRouter fallback');
        try {
          const response = await askOpenRouter(messages, maxTokens, temperature);
          console.log('⚡ BAKO: OpenRouter respondió (fallback)');
          return response;
        } catch (orErr) {
          console.warn('⚡ BAKO: OpenRouter también falló:', (orErr as any)?.response?.status, (orErr as any)?.response?.data?.error?.message);
          throw err; // re-throw error original de Groq (429) → cliente ve "Rate limit"
        }
      }
      throw err;
    }
  }

  try {
    const response = await askOllama(messages, maxTokens, temperature);
    console.log('🏠 BAKO: usando Ollama (local)');
    return response;
  } catch {
    console.warn('⚠️  Ollama no disponible → cambiando a Groq...');
    try {
      const response = await askGroq(messages, maxTokens, temperature);
      console.log(`☁️  BAKO: Groq fallback (temp=${temperature ?? 0.4})`);
      return response;
    } catch (groqErr) {
      if (isGroqRateLimit(groqErr) && process.env.OPENROUTER_API_KEY) {
        console.warn('⚡ BAKO: Groq rate limited (Ollama→Groq) → OpenRouter fallback');
        try {
          const response = await askOpenRouter(messages, maxTokens, temperature);
          console.log('⚡ BAKO: OpenRouter respondió (Ollama→Groq→OR)');
          return response;
        } catch (orErr) {
          console.warn('⚡ BAKO: OpenRouter también falló:', (orErr as any)?.response?.status);
          throw groqErr;
        }
      }
      throw groqErr;
    }
  }
}

// Clasificador por regex — determinista, 0ms, sin Ollama.
// Conservador: solo marca simple lo que claramente no necesita contexto de Atlas.
// Todo lo demás va a Groq con prompt completo.
// NOTA: no usar \b final con vocales acentuadas — en JS \b falla con chars no-ASCII (á,é,í,ó,ú)
export function classifyQueryComplexity(message: string): 'simple' | 'complex' {
  const msg = message.trim();
  const simple = [
    // saludos puros
    /^(hola|buenas?|buenos\s+d[íi]as?|buenas?\s+(tardes?|noches?))[\s.!?]*$/i,
    /^(c[óo]mo\s+est[áa]s|qu[ée]\s+tal)[\s.!?]*$/i,
    // tiempo / clima — sin \b final por vocales acentuadas
    /\b(va\s+a\s+llover|llover[áa]|llueve|la\s+lluvia|(?:el\s+)?tiempo\s+(?:ahora|hoy|esta?\s+tarde?|esta?\s+ma[ñn]ana?|de\s+ma[ñn]ana?)|qu[ée]\s+tiempo|pron[oó]stico|clima|temperatura|hace\s+(?:fr[íi]o|calor|sol|viento))/i,
    // hora y fecha
    /\b(qu[ée]\s+hora\s+es|qu[ée]\s+d[íi]a\s+(?:es|estamos?)|la\s+fecha\s+(?:de\s+)?hoy|fecha\s+actual)/i,
  ];
  return simple.some(p => p.test(msg)) ? 'simple' : 'complex';
}
