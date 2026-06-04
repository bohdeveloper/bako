import axios from 'axios';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b';
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

async function askOllama(messages: Message[], maxTokens?: number, temperature?: number): Promise<string> {
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    options: {
      num_ctx: 4096,
      ...(maxTokens   ? { num_predict: maxTokens }   : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    },
  });
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
    }
  );
  return data.choices[0]?.message?.content ?? 'Sin respuesta';
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
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
    const response = await askGroq(messages, maxTokens, temperature);
    console.log(`☁️  BAKO: Groq (temp=${temperature ?? 0.4})`);
    return response;
  }

  try {
    const response = await askOllama(messages, maxTokens, temperature);
    console.log('🏠 BAKO: usando Ollama (local)');
    return response;
  } catch {
    console.warn('⚠️  Ollama no disponible → cambiando a Groq...');
    const response = await askGroq(messages, maxTokens, temperature);
    console.log(`☁️  BAKO: Groq fallback (temp=${temperature ?? 0.4})`);
    return response;
  }
}
