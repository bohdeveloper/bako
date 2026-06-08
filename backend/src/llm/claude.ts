import axios from 'axios';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const GROQ_MODEL   = process.env.GROQ_MODEL   ?? 'llama-3.1-8b-instant';

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

async function askOllama(messages: Message[], maxTokens?: number, temperature?: number, numCtx = 8192): Promise<string> {
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    options: {
      num_ctx: numCtx,
      ...(maxTokens   ? { num_predict: maxTokens }   : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    },
  }, { timeout: 10_000 });
  return data.message?.content ?? 'Sin respuesta';
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

async function askOpenRouter(messages: Message[], maxTokens?: number, temperature?: number): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY no definido');

  const { data } = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: process.env.OPENROUTER_MODEL ?? 'google/gemma-4-31b-it:free',
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
  return data.choices[0]?.message?.content ?? 'Sin respuesta';
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
    { model: OLLAMA_MODEL, messages, stream: true, options: { num_ctx: 4096, ...(maxTokens ? { num_predict: maxTokens } : {}), ...(temperature !== undefined ? { temperature } : {}) } },
    { responseType: 'stream', timeout: 60000 }
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

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 6000 });
    return true;
  } catch {
    return false;
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
export function classifyQueryComplexity(message: string): 'simple' | 'complex' {
  const msg = message.trim();
  const simple = [
    // saludos puros
    /^(hola|buenas?|buenos\s+d[íi]as?|buenas?\s+(tardes?|noches?))[\s.!?]*$/i,
    /^(c[óo]mo\s+est[áa]s|qu[ée]\s+tal)[\s.!?]*$/i,
    // tiempo / clima
    /\b(llover[áa]|llueve|la\s+lluvia|(?:el\s+)?tiempo\s+(?:ahora|hoy|esta?\s+tarde?|esta?\s+ma[ñn]ana?)|clima|temperatura)\b/i,
    // hora y fecha
    /\b(qu[ée]\s+hora\s+es|qu[ée]\s+d[íi]a\s+(?:es|estamos?)|la\s+fecha\s+(?:de\s+)?hoy|fecha\s+actual)\b/i,
  ];
  return simple.some(p => p.test(msg)) ? 'simple' : 'complex';
}
