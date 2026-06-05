import axios from 'axios';

const OLLAMA_URL    = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL  = 'nomic-embed-text';  // 768 dims

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const CF_API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN  ?? '';
const CF_MODEL      = '@cf/baai/bge-small-en-v1.5';     // 384 dims

export interface EmbeddingResult {
  vector: number[];
  dim:    number;
  model:  string;
}

async function embedOllama(text: string): Promise<EmbeddingResult> {
  // New API (Ollama 0.3+): /api/embed
  try {
    const { data } = await axios.post(`${OLLAMA_URL}/api/embed`,
      { model: OLLAMA_MODEL, input: text },
      { timeout: 8000 }
    );
    const vector: number[] = data.embeddings?.[0];
    if (vector?.length) return { vector, dim: vector.length, model: OLLAMA_MODEL };
  } catch { /* try legacy */ }

  // Legacy API: /api/embeddings
  const { data } = await axios.post(`${OLLAMA_URL}/api/embeddings`,
    { model: OLLAMA_MODEL, prompt: text },
    { timeout: 8000 }
  );
  const vector: number[] = data.embedding;
  if (!vector?.length) throw new Error('Ollama no devolvió embedding');
  return { vector, dim: vector.length, model: OLLAMA_MODEL };
}

async function embedCloudflare(text: string): Promise<EmbeddingResult> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) throw new Error('Cloudflare env vars no definidas');
  const { data } = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`,
    { text: [text] },
    {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 12000,
    }
  );
  const vector: number[] = data.result?.data?.[0];
  if (!vector?.length) throw new Error('Cloudflare Workers AI no devolvió embedding');
  return { vector, dim: vector.length, model: CF_MODEL };
}

/** Genera embedding intentando Ollama primero, fallback a Cloudflare Workers AI. */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const t = text.slice(0, 2000); // ~512 tokens — suficiente para memorias
  try {
    const result = await embedOllama(t);
    console.log(`🔢 Embedding Ollama (${result.dim} dims)`);
    return result;
  } catch {
    const result = await embedCloudflare(t);
    console.log(`🔢 Embedding Cloudflare Workers AI (${result.dim} dims)`);
    return result;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
