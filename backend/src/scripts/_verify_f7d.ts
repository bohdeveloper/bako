/**
 * Verificación de la Fase 7d (router de la nube) con axios simulado: sin red, sin Mongo.
 * Ejecutar: npx ts-node src/scripts/_verify_f7d.ts
 */
import axios from 'axios';

process.env.GROQ_API_KEY        = 'test-groq';
process.env.GEMINI_API_KEY      = 'test-gemini';
process.env.OPENROUTER_API_KEY  = 'test-or';
process.env.GROQ_MODEL          = 'groq-a';
process.env.GROQ_FALLBACK_MODEL = 'groq-b';
process.env.GEMINI_MODEL        = 'gem';
process.env.OLLAMA_URL          = 'http://ollama.test';

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
}

type Respuesta = { status?: number; headers?: Record<string, string>; message?: object; error?: string };
let llamadas: string[] = [];
let guion: Record<string, Respuesta[]> = {};

/** Quién recibe la petición: el modelo pedido, o "ollama"/"openrouter". */
function destino(url: string, body: any): string {
  if (url.startsWith('http://ollama.test')) return 'ollama';
  if (url.includes('openrouter.ai')) return 'openrouter';
  return body.model;
}

(axios as any).post = async (url: string, body: any) => {
  const d = destino(url, body);
  llamadas.push(d);
  if (d === 'ollama') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const r = guion[d]?.shift() ?? {};
  if (r.status && r.status >= 400) {
    throw Object.assign(new Error(`Request failed with status code ${r.status}`), {
      response: { status: r.status, headers: r.headers ?? {}, data: { error: { message: r.error ?? '' } } },
    });
  }
  return { headers: r.headers ?? {}, data: { choices: [{ message: r.message ?? { content: `hola desde ${d}` } }] } };
};

const herramientas = [{ type: 'function', function: { name: 'crear_evento', parameters: {} } }];
const grande = 'x'.repeat(7000 * 3.5); // ~7.000 tokens, como el prompt completo de BAKO

async function main() {
  const claude = await import('../llm/claude');
  const { askClaude, askClaudeWithTools, parseDuration, describeRuntime, _resetCloudRouter, PrivacyError } = claude;
  const reset = (g: Record<string, Respuesta[]> = {}) => { _resetCloudRouter(); llamadas = []; guion = g; };

  // 1) parseDuration con los formatos reales de Groq y Retry-After
  check('parseDuration', parseDuration('7.66s') === 7660 && parseDuration('2m59.56s') === 179_560
    && parseDuration('250ms') === 250 && parseDuration('30') === 30_000 && parseDuration('basura') === undefined);

  // 2) Camino feliz: responde el primer modelo de Groq
  reset();
  let r = await askClaudeWithTools('hola', herramientas, { useCloud: true });
  check('feliz: Groq principal', r.provider === 'groq' && llamadas.join() === 'groq-a', llamadas.join());

  // 3) Cuota de tokens declarada en cabeceras: el siguiente prompt grande NO se manda a groq-a
  reset({ 'groq-a': [{ headers: { 'x-ratelimit-remaining-tokens': '300', 'x-ratelimit-reset-tokens': '40s' } }] });
  await askClaude('corto', { useCloud: true });
  llamadas = [];
  await askClaude(grande, { useCloud: true });
  check('cuota de tokens: salta groq-a sin llamarlo', llamadas.join() === 'groq-b', llamadas.join());
  // …pero una petición que sí cabe en esos 300 tokens va a groq-a (sin maxTokens se reservan 512)
  llamadas = [];
  await askClaude('hola', { useCloud: true, maxTokens: 50 });
  check('cuota de tokens: un mensaje que cabe sí va a groq-a', llamadas.join() === 'groq-a', llamadas.join());

  // 4) 429 con retry-after: se pausa y el siguiente mensaje ya no lo intenta
  reset({ 'groq-a': [{ status: 429, headers: { 'retry-after': '30' } }] });
  await askClaude('uno', { useCloud: true });
  check('429: cae al segundo modelo en la misma petición', llamadas.join() === 'groq-a,groq-b', llamadas.join());
  llamadas = [];
  await askClaude('dos', { useCloud: true });
  check('429: el siguiente mensaje no paga el intento fallido', llamadas.join() === 'groq-b', llamadas.join());

  // 5) Groq entero sin cuota → Gemini, con herramientas
  reset({
    'groq-a': [{ status: 429, error: 'Rate limit reached. Please try again in 7.66s.' }],
    'groq-b': [{ status: 429 }],
    gem:      [{ message: { content: '', tool_calls: [{ function: { name: 'crear_evento', arguments: '{"titulo":"dentista"}' } }] } }],
  });
  r = await askClaudeWithTools('apunta dentista', herramientas, { useCloud: true });
  check('Groq agotado → Gemini con tool-calling', r.provider === 'gemini' && r.toolCall?.name === 'crear_evento'
    && r.toolCall.arguments.titulo === 'dentista', `${llamadas.join()} · ${JSON.stringify(r.toolCall)}`);
  check('describeRuntime nombra al proveedor que va a responder', describeRuntime(true).startsWith('Google Gemini'), describeRuntime(true));

  // 6) Toda la nube caída → OpenRouter, SIN herramientas
  reset({ 'groq-a': [{ status: 429 }], 'groq-b': [{ status: 503 }], gem: [{ status: 429, error: 'Quota exceeded: GenerateRequestsPerDay' }] });
  r = await askClaudeWithTools('apunta dentista', herramientas, { useCloud: true });
  check('nube agotada → OpenRouter sin toolCall', r.provider === 'openrouter' && !r.toolCall, llamadas.join());
  llamadas = [];
  r = await askClaudeWithTools('otra', herramientas, { useCloud: true });
  check('con todo en pausa va directo a OpenRouter', llamadas.join() === 'openrouter', llamadas.join());

  // 7) Sin OpenRouter y todo en pausa → error con forma de 429 (lo que react.ts sabe explicar)
  const orKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  llamadas = [];
  try {
    await askClaude('algo', { useCloud: true });
    check('todo en pausa sin OpenRouter lanza 429', false, 'no lanzó');
  } catch (e: any) {
    check('todo en pausa sin OpenRouter lanza 429', e?.response?.status === 429 && llamadas.length === 0, `${e?.message} · ${llamadas.join()}`);
  }
  process.env.OPENROUTER_API_KEY = orKey;

  // 8) 401 en Groq: se aparta 10 min, no en cada mensaje
  reset({ 'groq-a': [{ status: 401 }], 'groq-b': [{ status: 401 }] });
  await askClaude('uno', { useCloud: true });
  llamadas = [];
  await askClaude('dos', { useCloud: true });
  check('401: no se reintenta en el siguiente mensaje', llamadas.join() === 'gem', llamadas.join());

  // 9) 413 (petición más grande que la cuota): se salta solo esa vez
  reset({ 'groq-a': [{ status: 413 }] });
  await askClaude(grande, { useCloud: true });
  llamadas = [];
  await askClaude('corto', { useCloud: true });
  check('413: no pausa el modelo para el resto', llamadas.join() === 'groq-a', llamadas.join());

  // 10) Ollama caído sin useCloud → nube; privado → PrivacyError y ni una llamada a la nube
  reset();
  r = await askClaudeWithTools('hola', herramientas, {});
  check('Ollama caído → nube', r.provider === 'groq' && llamadas.join() === 'ollama,groq-a', llamadas.join());
  llamadas = [];
  try {
    await askClaude('dato privado', { private: true });
    check('privado no sale a la nube', false, 'no lanzó');
  } catch (e) {
    check('privado no sale a la nube', e instanceof PrivacyError && llamadas.join() === 'ollama', llamadas.join());
  }

  // ── Arreglos de /code-review ──────────────────────────────────────────────
  const { toolCallingValidado } = claude;

  // 11) Gate de confirmación: solo gpt-oss (GROQ_MODEL) está validado
  reset({ 'groq-a': [{ status: 429 }], 'groq-b': [{ message: { tool_calls: [{ function: { name: 'crear_evento', arguments: '{}' } }] } }] });
  r = await askClaudeWithTools('apunta', herramientas, { useCloud: true });
  check('respaldo qwen no está validado → confirma', r.model === 'groq-b' && !toolCallingValidado(r));
  reset();
  r = await askClaudeWithTools('apunta', herramientas, { useCloud: true });
  check('Groq principal sí está validado', r.model === 'groq-a' && toolCallingValidado(r));

  // 12) Reserva: dos peticiones grandes simultáneas no salen las dos al mismo cubo
  reset({ 'groq-a': [{ headers: { 'x-ratelimit-remaining-tokens': '8000', 'x-ratelimit-reset-tokens': '60s' } }] });
  await askClaude('hola', { useCloud: true, maxTokens: 10 });
  llamadas = [];
  await Promise.all([askClaude(grande, { useCloud: true, maxTokens: 300 }), askClaude(grande, { useCloud: true, maxTokens: 300 })]);
  check('concurrencia: la segunda va al otro modelo', [...llamadas].sort().join() === 'groq-a,groq-b', llamadas.join());

  // 13) Gemini con key inválida (400 "API key not valid") se aparta 10 min
  reset({ 'groq-a': [{ status: 429 }, { status: 429 }], 'groq-b': [{ status: 429 }, { status: 429 }], gem: [{ status: 400, error: 'API key not valid. Please pass a valid API key.' }] });
  await askClaude('uno', { useCloud: true }).catch(() => {});
  _resetCloudRouter();  // libera Groq pero no basta: hay que ver que Gemini sigue apartado
  guion = { 'groq-a': [{ status: 429 }], 'groq-b': [{ status: 429 }], gem: [{ status: 400, error: 'API key not valid.' }] };
  await askClaude('dos', { useCloud: true }).catch(() => {});
  llamadas = [];
  await askClaude('tres', { useCloud: true }).catch(() => {});
  check('key de Gemini inválida: no se reintenta', !llamadas.includes('gem'), llamadas.join());

  // 14) El error que se devuelve: si algo cayó por cuota, es un 429 aunque el último fuera un 503
  delete process.env.OPENROUTER_API_KEY;
  reset({ 'groq-a': [{ status: 429 }], 'groq-b': [{ status: 429 }], gem: [{ status: 503 }] });
  try { await askClaude('x', { useCloud: true }); } catch (e: any) {
    check('429 + 503 → se cuenta como sin cuota', e?.response?.status === 429, e?.message);
  }
  // …y con las keys rechazadas, el siguiente mensaje NO dice "sin cuota"
  reset({ 'groq-a': [{ status: 401 }], 'groq-b': [{ status: 401 }], gem: [{ status: 401 }] });
  await askClaude('x', { useCloud: true }).catch(() => {});
  try { await askClaude('y', { useCloud: true }); } catch (e: any) {
    check('keys rechazadas → no se disfraza de 429', e?.response?.status !== 429 && /credenciales/.test(e?.message), e?.message);
  }
  process.env.OPENROUTER_API_KEY = orKey;

  // 15) Cuota diaria con "try again in" → respeta el plazo indicado, no 1 h
  reset({ 'groq-a': [{ status: 429, error: 'Rate limit reached on tokens per day (TPD). Please try again in 1.5s.' }] });
  await askClaude('x', { useCloud: true });
  await new Promise(res => setTimeout(res, 1600));
  llamadas = [];
  await askClaude('y', { useCloud: true });
  check('diaria con plazo: vuelve a groq-a tras el plazo', llamadas.join() === 'groq-a', llamadas.join());

  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Fase 7d verificada');
  process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
