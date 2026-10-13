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

// ── Router de proveedores en la nube (Fase 7d) ───────────────────────────────
// Groq da ~8.000 tokens/minuto POR MODELO y el prompt completo de BAKO ronda los
// 7.700 (medido el 05/09/2026): una sola petición vacía casi todo el minuto, y
// la siguiente comía un 429 seguro. Reaccionar al error no basta — el usuario
// paga la latencia del intento fallido en cada mensaje. El router recuerda la
// cuota que cada proveedor declara en sus cabeceras y se salta, sin llamarlo,
// el que no tiene cubo para la petición que va a enviar.
// Todos hablan la API de OpenAI, así que un solo cliente sirve para todos.
// El orden de la lista es la preferencia; OpenRouter queda fuera, como último
// recurso sin herramientas (ver `chatCloudOrOpenRouter`).

type CloudName = 'groq' | 'gemini';

interface CloudProvider {
  id:     string;                     // clave de la cuota: proveedor + modelo, porque Groq limita por modelo
  name:   CloudName;
  url:    string;
  model:  string;
  apiKey: string;
  extra?: Record<string, unknown>;    // parámetros propios del modelo
}

// Segundo modelo de Groq, con su propio cubo de cuota. Probado el 13/10/2026:
// tool-calling correcto y 0,2–0,4 s sin razonamiento.
const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL ?? 'qwen/qwen3.8-27b';
// gemini-2.5-flash ya da 404 a cuentas nuevas; 3.5-flash probado el 13/10/2026:
// 0,8 s en texto y tool-calling correcto. Los 3.7/3.8 daban 503 por saturación.
const GEMINI_MODEL        = process.env.GEMINI_MODEL        ?? 'gemini-3.5-flash';
const GROQ_URL            = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL          = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const CLOUD_TIMEOUT_MS    = 15_000;
// Presupuesto de toda la cadena de la nube por petición: en serie y con 15 s
// cada uno, tres proveedores lentos sumaban 45 s y pasaban de largo el safety
// de 25 s de los endpoints desktop — el que sí habría respondido no llegaba.
const CLOUD_BUDGET_MS      = 20_000;
const CLOUD_MIN_ATTEMPT_MS = 3_000;

// Los modelos que razonan gastan tokens y segundos en un pensamiento que no se
// usa: BAKO necesita la respuesta, no el razonamiento. Solo a los que aceptan
// apagarlo — gemini-2.5-pro, por ejemplo, responde 400 si se le pide.
function sinRazonamiento(model: string): Record<string, unknown> | undefined {
  return /qwen|gemini-[\d.]+-flash/i.test(model) ? { reasoning_effort: 'none' } : undefined;
}

function cloudProviders(): CloudProvider[] {
  const list: CloudProvider[] = [];
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    for (const model of new Set([GROQ_MODEL, GROQ_FALLBACK_MODEL].filter(Boolean))) {
      list.push({ id: `groq:${model}`, name: 'groq', url: GROQ_URL, model, apiKey: groqKey, extra: sinRazonamiento(model) });
    }
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    list.push({ id: `gemini:${GEMINI_MODEL}`, name: 'gemini', url: GEMINI_URL, model: GEMINI_MODEL, apiKey: geminiKey, extra: sinRazonamiento(GEMINI_MODEL) });
  }
  return list;
}

interface Cuota {
  pausaHasta:    number;   // no se le llama hasta entonces (429, credenciales, modelo retirado…)
  pausaMotivo?:  string;
  pausaPorCuota?: boolean; // 429 → "sin cuota"; 401 o modelo retirado → otra cosa que contar
  tokensLibres?: number;   // lo que declaró la última respuesta…
  tokensHasta?:  number;   // …y hasta cuándo vale ese dato
}
const cuotas = new Map<string, Cuota>();

/** Solo para `_verify_f7d.ts`: cada escenario arranca con todas las cuotas libres. */
export function _resetCloudRouter(): void { cuotas.clear(); }

// Formato de Groq ("7.66s", "2m59.56s", "250ms") o segundos a secas (Retry-After).
export function parseDuration(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const unidades: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  let total = 0;
  let encontrado = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(n) * unidades[u];
    encontrado = true;
  }
  return encontrado ? total : undefined;
}

// Estimación gruesa (~3,5 caracteres por token en español) más la respuesta
// pedida. Basta para no mandar 7.700 tokens a un cubo al que le quedan 300.
// Los esquemas de herramientas cuentan: Groq los descuenta de la misma cuota.
function estimarTokens(messages: Message[], maxTokens?: number, tools?: object[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0) + (tools ? JSON.stringify(tools).length : 0);
  return Math.ceil(chars / 3.5) + (maxTokens ?? 512);
}

// Por qué no se puede llamar ahora a un proveedor, o null si se puede.
function bloqueo(p: CloudProvider, tokens: number): { porCuota: boolean; motivo: string } | null {
  const c = cuotas.get(p.id);
  if (!c) return null;
  const ahora = Date.now();
  if (c.pausaHasta > ahora) return { porCuota: c.pausaPorCuota ?? false, motivo: c.pausaMotivo ?? 'en pausa' };
  if (c.tokensLibres !== undefined && (c.tokensHasta ?? 0) > ahora && c.tokensLibres < tokens) {
    return { porCuota: true, motivo: `le quedan ${c.tokensLibres} tokens y la petición necesita ~${tokens}` };
  }
  return null;
}

// Se descuenta antes de enviar: dos mensajes casi simultáneos (Telegram y
// desktop, o los agentes PM/Dev) veían el mismo cubo libre y salían los dos a
// él, y el segundo comía un 429 seguro. La respuesta corrige el dato con el real.
function reservar(p: CloudProvider, tokens: number): void {
  const c = cuotas.get(p.id);
  if (c?.tokensLibres !== undefined && (c.tokensHasta ?? 0) > Date.now()) c.tokensLibres -= tokens;
}

function pausar(p: CloudProvider, ms: number, motivo: string, porCuota: boolean): void {
  const c = cuotas.get(p.id) ?? { pausaHasta: 0 };
  cuotas.set(p.id, { ...c, pausaHasta: Date.now() + ms, pausaMotivo: motivo, pausaPorCuota: porCuota });
  console.warn(`⏸️  BAKO: ${p.id} en pausa ${Math.round(ms / 1000)} s → ${motivo}`);
}

// Groq declara en cada respuesta lo que le queda; Gemini no, y entonces solo
// cuenta el 429.
function anotarCuota(p: CloudProvider, headers: Record<string, any> = {}): void {
  const ahora = Date.now();
  const c = cuotas.get(p.id) ?? { pausaHasta: 0 };
  if (headers['x-ratelimit-remaining-requests'] === '0') {
    c.pausaHasta = ahora + (parseDuration(headers['x-ratelimit-reset-requests']) ?? 60_000);
  }
  const libres = Number(headers['x-ratelimit-remaining-tokens']);
  if (Number.isFinite(libres) && headers['x-ratelimit-remaining-tokens'] !== undefined) {
    c.tokensLibres = libres;
    c.tokensHasta  = ahora + (parseDuration(headers['x-ratelimit-reset-tokens']) ?? 60_000);
  }
  cuotas.set(p.id, c);
}

// Cuánto tiempo apartar a un proveedor tras un error. 0 = solo se salta para
// esta petición (el siguiente mensaje sí puede ir a él).
function pausaPorError(err: unknown): { ms: number; motivo: string } {
  const e       = err as any;
  const status  = e?.response?.status as number | undefined;
  const headers = e?.response?.headers ?? {};
  const msg     = String(e?.response?.data?.error?.message ?? e?.message ?? '');

  if (status === 429) {
    // Lo que diga el propio proveedor manda: Groq anuncia también su cuota
    // diaria con un "try again in 2m10s", y apartarlo 1 h sería tirar 58 min de
    // modelo principal. La hora fija es solo para cuando no dice nada (Gemini).
    const indicado = parseDuration(headers['retry-after'])
      ?? parseDuration(msg.match(/(?:try again|retry) in ([\d.hms]+)/i)?.[1]);
    if (/per ?day|daily|RPD/i.test(msg)) return { ms: indicado ?? 3_600_000, motivo: 'cuota diaria agotada' };
    return { ms: indicado ?? 60_000, motivo: '429, límite por minuto' };
  }
  if (status === 413) return { ms: 0, motivo: 'petición más grande que su cuota por minuto' };
  // Google responde a una key inválida con 400 INVALID_ARGUMENT, no con 401.
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(msg))) {
    return { ms: 600_000, motivo: `credenciales rechazadas (${status})` };
  }
  if (status === 404 || (status === 400 && /model.*(not found|decommissioned|does not exist)/i.test(msg))) {
    return { ms: 3_600_000, motivo: 'modelo no disponible' };
  }
  if (status !== undefined && status < 500) return { ms: 0, motivo: `petición rechazada (${status}): ${msg.slice(0, 120)}` };
  return { ms: 20_000, motivo: [e?.code, status, msg.slice(0, 80)].filter(Boolean).join(' · ') || 'caída del servicio' };
}

function esPorCuota(err: unknown): boolean {
  const status = (err as any)?.response?.status;
  return status === 429 || status === 413;
}

function apartar(p: CloudProvider, err: unknown): void {
  const { ms, motivo } = pausaPorError(err);
  if (ms > 0) pausar(p, ms, motivo, esPorCuota(err));
  else console.warn(`↪️  BAKO: ${p.id} se salta para esta petición → ${motivo}`);
}

// Mismo aspecto que un 429 de axios: `agents/react.ts` y las rutas ya saben
// convertir eso en un mensaje claro para el señor.
function nubeAgotada(): Error {
  return Object.assign(new Error('429: todos los proveedores en la nube están sin cuota ahora mismo'), { response: { status: 429 } });
}

interface CloudOptions { tools?: object[]; maxTokens?: number; temperature?: number }

function cloudBody(p: CloudProvider, messages: Message[], o: CloudOptions, stream = false): object {
  return {
    model: p.model,
    messages,
    ...(o.tools ? { tools: o.tools, tool_choice: 'auto' } : {}),
    ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
    temperature: o.temperature ?? 0.4,  // default 0.4 — preciso sin ser robótico
    ...(stream ? { stream: true } : {}),
    ...p.extra,
  };
}

// El recorrido común a `chatCloud` y `streamCloud`: prueba los proveedores en
// orden, sin llamar al que no puede atender la petición, dentro del presupuesto.
async function porProveedores(
  tokens: number,
  enviar: (p: CloudProvider, timeout: number) => Promise<{ data: any; headers?: any }>,
): Promise<{ res: { data: any; headers?: any }; provider: CloudProvider }> {
  const providers = cloudProviders();
  if (!providers.length) throw new Error('Ningún proveedor en la nube configurado (GROQ_API_KEY / GEMINI_API_KEY)');
  const fin = Date.now() + CLOUD_BUDGET_MS;

  let lastErr: unknown;
  let sinCuota = false;
  for (const p of providers) {
    const b = bloqueo(p, tokens);
    if (b) {
      if (b.porCuota) sinCuota = true;
      else lastErr ??= new Error(`${p.id} apartado: ${b.motivo}`);
      continue;
    }
    const restante = fin - Date.now();
    if (restante < CLOUD_MIN_ATTEMPT_MS) break;
    reservar(p, tokens);
    try {
      const res = await enviar(p, Math.min(CLOUD_TIMEOUT_MS, restante));
      anotarCuota(p, res.headers);
      if (p !== providers[0]) console.log(`☁️  BAKO: respondió ${p.id} (escalón de respaldo)`);
      return { res, provider: p };
    } catch (err) {
      apartar(p, err);
      if (esPorCuota(err)) sinCuota = true;
      lastErr = err;
    }
  }
  // Si algún escalón cayó por cuota, eso es lo que hay que contar: el cliente
  // convierte un 429 en "límite alcanzado", y un 503 del último proveedor lo taparía.
  throw sinCuota || !lastErr ? nubeAgotada() : lastErr;
}

async function chatCloud(messages: Message[], o: CloudOptions): Promise<{ message: RawToolMessage; provider: CloudName; model: string }> {
  const { res, provider } = await porProveedores(estimarTokens(messages, o.maxTokens, o.tools), (p, timeout) =>
    axios.post(p.url, cloudBody(p, messages, o), {
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      timeout,
    }));
  return { message: res.data.choices?.[0]?.message ?? {}, provider: provider.name, model: provider.model };
}

// OpenRouter es el último escalón y va SIN herramientas: los modelos gratuitos
// de ese catálogo no tienen tool-calling fiable, así que ahí BAKO degrada a
// conversación pura en vez de arriesgarse a alucinar una acción.
async function chatCloudOrOpenRouter(messages: Message[], o: CloudOptions): Promise<{ message: RawToolMessage; provider: CloudName | 'openrouter'; model?: string }> {
  try {
    return await chatCloud(messages, o);
  } catch (err) {
    if (!process.env.OPENROUTER_API_KEY) throw err;
    console.warn('⚡ BAKO: nube sin cuota → OpenRouter (sin herramientas)');
    try {
      const text = await askOpenRouter(messages, o.maxTokens, o.temperature);
      return { message: { content: text }, provider: 'openrouter' };
    } catch (orErr) {
      console.warn('⚡ BAKO: OpenRouter también falló:', (orErr as any)?.response?.status, (orErr as any)?.response?.data?.error?.message);
      throw err; // el error original de la nube (p. ej. 429) es el que el cliente sabe explicar
    }
  }
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

// Mismo router que `chatCloud`, pero solo se puede cambiar de proveedor antes del
// primer token: a mitad de respuesta ya no hay vuelta atrás.
async function* streamCloud(messages: Message[], maxTokens?: number, temperature?: number): AsyncGenerator<string> {
  // El timeout del presupuesto cubre solo hasta que empiezan a llegar tokens;
  // axios no corta un stream ya abierto por ese timeout.
  const { res: response } = await porProveedores(estimarTokens(messages, maxTokens), (p, timeout) =>
    axios.post(p.url, cloudBody(p, messages, { maxTokens, temperature }, true), {
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' }, responseType: 'stream', timeout,
    }));
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
  if (useCloud)  { yield* streamCloud(messages, maxTokens, temperature);  console.log('☁️  BAKO stream: nube');         return; }

  try {
    yield* streamOllama(messages, maxTokens, temperature);
    console.log('🏠 BAKO stream: Ollama (local)');
  } catch {
    console.warn('⚠️  Ollama stream no disponible → nube...');
    yield* streamCloud(messages, maxTokens, temperature);
    console.log('☁️  BAKO stream: nube (fallback)');
  }
}

/**
 * Quién está sirviendo la petición, en texto, para inyectarlo en el prompt.
 * Sin esto BAKO no tiene forma de saberlo y se lo inventa: preguntado el
 * 05/09/2026 si usaba la GPU del PC, contestó "estoy operando como un modelo de
 * lenguaje basado en la nube" mientras corría en la GPU de casa.
 * No se codifica el modelo de GPU a propósito — ya cambió una vez.
 * En la nube se nombra el primer proveedor con cuota, que es el que el router
 * va a usar: decir "Groq" con Groq en pausa sería la misma alucinación. Se
 * calcula antes de montar el prompt, así que se estima con el tamaño típico de
 * un turno completo (prompt + herramientas), no con cero.
 */
export function describeRuntime(useCloud: boolean, tokensEstimados = 9_000): string {
  if (!useCloud) return `Ollama con el modelo ${OLLAMA_MODEL}, en la GPU del PC de casa del señor, a través del túnel Cloudflare`;
  const p = cloudProviders().find(c => !bloqueo(c, tokensEstimados));
  if (!p) return 'un modelo gratuito en la nube (los proveedores principales están sin cuota ahora mismo)';
  return `${p.name === 'gemini' ? 'Google Gemini' : 'Groq'}, en la nube, con el modelo ${p.model}`;
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

// Sondeo cacheado 30 s. Vive aquí y no en la ruta desktop porque lo necesitan
// dos sitios: el badge de la PWA y, antes de construir el prompt, saber qué
// proveedor va a responder de verdad — con el túnel caído, pedir Ollama acaba
// en Groq, y decirle al prompt lo contrario es justo la alucinación que se
// quiere evitar.
let ollamaCache: { available: boolean; ts: number } = { available: false, ts: 0 };
export async function isOllamaAvailableCached(): Promise<boolean> {
  if (Date.now() - ollamaCache.ts < 30_000) return ollamaCache.available;
  const available = await isOllamaAvailable();
  ollamaCache = { available, ts: Date.now() };
  return available;
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
  provider:  'ollama' | CloudName | 'openrouter'; // quién respondió de verdad — puede no ser el `useCloud` pedido, si hubo fallback
  model?:    string;                              // en la nube, qué modelo exacto (el router puede usar varios)
}

/**
 * ¿Se puede ejecutar una escritura que propuso este modelo sin pedir
 * confirmación? Solo el que se validó: probado el 05/09/2026, `gpt-oss-120b`
 * acertó las 4 pruebas sin un falso positivo, mientras qwen3:8b creó una tarea
 * real en Notion pidiéndole un chiste. Los escalones de respaldo del router
 * (qwen en Groq, Gemini) no se han validado así, y ante la duda se confirma.
 */
export function toolCallingValidado(r: ToolCallResponse): boolean {
  return r.provider === 'groq' && r.model === GROQ_MODEL;
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

// Una sola llamada decide, con el mismo contexto de siempre, si BAKO conversa o
// actúa — sustituye al patrón antiguo de "regex + segunda llamada de extracción"
// (no dobla el número de peticiones al LLM por mensaje). Cadena de resiliencia
// igual que `askClaude` (Ollama → router de la nube → OpenRouter), con una
// diferencia importante: si toca OpenRouter, va SIN herramientas.
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

  // Sin toolCall si respondió OpenRouter — ver `chatCloudOrOpenRouter`.
  async function viaNube(): Promise<ToolCallResponse> {
    const { message, provider, model } = await chatCloudOrOpenRouter(messages, { tools, maxTokens, temperature });
    return { text: stripThinking(message.content ?? ''), toolCall: parseToolCall(message), provider, model };
  }

  if (useCloud) return viaNube();

  try {
    const message = await chatOllamaWithTools(messages, tools, maxTokens, temperature);
    return { text: stripThinking(message.content ?? ''), toolCall: parseToolCall(message), provider: 'ollama' };
  } catch {
    console.warn('⚠️  Ollama no disponible → nube...');
    return viaNube();
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

  async function viaNube(): Promise<string> {
    const { message, provider } = await chatCloudOrOpenRouter(messages, { maxTokens, temperature });
    console.log(`☁️  BAKO: ${provider} (temp=${temperature ?? 0.4})`);
    return stripThinking(message.content ?? '') || 'Sin respuesta';
  }

  if (useCloud) return viaNube();

  try {
    const response = await askOllama(messages, maxTokens, temperature);
    console.log('🏠 BAKO: usando Ollama (local)');
    return response;
  } catch {
    console.warn('⚠️  Ollama no disponible → nube...');
    return viaNube();
  }
}

// Clasificador por regex — determinista, 0ms, sin Ollama.
// Conservador: solo marca simple lo que claramente no necesita contexto de Atlas.
// Todo lo demás va a Groq con prompt completo.
// NOTA: no usar \b final con vocales acentuadas — en JS \b falla con chars no-ASCII (á,é,í,ó,ú)
// "Hola Bako" no colaba en los saludos de abajo (el ancla final `$` no dejaba
// sitio al vocativo): se clasificaba "complex" y usaba el prompt completo para
// un simple saludo. No es solo una cuestión de presupuesto de prompt —
// encontrado el 18/09/2026 al comprobar que ese saludo salía como "¿Qué ha
// querido decir, señor?". Fuera de la función (que se llama en cada mensaje
// entrante) para no reconstruir las regex en cada llamada.
const VOCATIVO = '(?:[\\s,]+bako)?';
const SIMPLE_PATTERNS = [
  // saludos puros, con o sin el vocativo "Bako" detrás
  new RegExp(`^(hola|buenas?|buenos\\s+d[íi]as?|buenas?\\s+(tardes?|noches?))${VOCATIVO}[\\s.!?]*$`, 'i'),
  new RegExp(`^(c[óo]mo\\s+est[áa]s|qu[ée]\\s+tal)${VOCATIVO}[\\s.!?]*$`, 'i'),
  // tiempo / clima — sin \b final por vocales acentuadas
  /\b(va\s+a\s+llover|llover[áa]|llueve|la\s+lluvia|(?:el\s+)?tiempo\s+(?:ahora|hoy|esta?\s+tarde?|esta?\s+ma[ñn]ana?|de\s+ma[ñn]ana?)|qu[ée]\s+tiempo|pron[oó]stico|clima|temperatura|hace\s+(?:fr[íi]o|calor|sol|viento))/i,
  // hora y fecha
  /\b(qu[ée]\s+hora\s+es|qu[ée]\s+d[íi]a\s+(?:es|estamos?)|la\s+fecha\s+(?:de\s+)?hoy|fecha\s+actual)/i,
];

export function classifyQueryComplexity(message: string): 'simple' | 'complex' {
  const msg = message.trim();
  return SIMPLE_PATTERNS.some(p => p.test(msg)) ? 'simple' : 'complex';
}
