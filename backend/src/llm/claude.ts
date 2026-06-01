import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b';
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

interface AskClaudeOptions {
  systemPrompt?: string;
  maxTokens?: number;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function askOllama(messages: Message[], maxTokens?: number): Promise<string> {
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    ...(maxTokens ? { options: { num_predict: maxTokens } } : {}),
  });
  return data.message?.content ?? 'Sin respuesta';
}

async function askGroq(messages: Message[], maxTokens?: number): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Ollama no disponible y GROQ_API_KEY no está definido en .env');

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      messages,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
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

export async function askClaude(prompt: string, options: AskClaudeOptions = {}): Promise<string> {
  const { systemPrompt, maxTokens } = options;

  const messages: Message[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  try {
    const response = await askOllama(messages, maxTokens);
    console.log('🏠 BAKO: usando Ollama (local)');
    return response;
  } catch {
    console.warn('⚠️  Ollama no disponible → cambiando a Groq...');
    const response = await askGroq(messages, maxTokens);
    console.log('☁️  BAKO: usando Groq (cloud)');
    return response;
  }
}
