import { Memory, IMemory } from '../memory/Memory';
import { askClaude } from '../llm/claude';
import { generateEmbedding } from './embeddings';
import { buscarMemoriasSimilares } from './vectorSearch';

export async function saveMemory(
  content: string,
  options: {
    type?:       IMemory['type'];
    importance?: IMemory['importance'];
    source?:     IMemory['source'];
    tags?:       string[];
    privado?:    boolean; // §3.3: el embedding no sale a Cloudflare si Ollama falla
  } = {}
): Promise<IMemory> {
  const saved = await Memory.create({
    content,
    type:       options.type       ?? 'fact',
    importance: options.importance ?? 'medium',
    source:     options.source     ?? 'extracted',
    tags:       options.tags       ?? [],
  });

  // Generar embedding en background — no bloquea la respuesta al usuario
  generateEmbedding(content, { privado: options.privado }).then(({ vector, dim, model }) =>
    Memory.findByIdAndUpdate(saved._id, { embedding: vector, embeddingDim: dim, embeddingModel: model })
  ).catch(() => {}); // Silent fail — sin embedding BAKO sigue funcionando

  return saved;
}

export async function getMemories(
  technicalLimit = 2,
  _personalLimit = 44,  // ignorado — ahora usamos búsqueda semántica o el fallback genérico
  query?: string,       // 7b-C: si se pasa, usa búsqueda semántica
  // §3.3: hasta el 16/09/2026 esta función no sabía de privacidad — un turno
  // sensible ("mi nómina de Inetum") con Ollama arriba pero su modelo de
  // embeddings caído se embebía igual vía Cloudflare, porque `generateEmbedding`
  // solo corta ese fallback si alguien le pasa `privado:true` explícitamente.
  // Encontrado en /code-review al revisar el gate de voz de Telegram.
  privado = false,
): Promise<IMemory[]> {
  // ── 7b-C + B5: búsqueda semántica cuando hay query — Atlas Vector Search con
  // fallback automático al coseno en memoria (`buscarMemoriasSimilares`) ───────
  if (query) {
    try {
      const { vector, dim } = await generateEmbedding(query, { privado });
      const scored = await buscarMemoriasSimilares(vector, dim, { minScore: 0.15, limit: 15 });
      if (scored.length >= 5) {
        medirContexto('semántica', scored.map(s => s.m));
        return scored.map(s => s.m);
      }
    } catch { /* fallback genérico si falla el embedding */ }
  }

  // ── B5.3: fallback genérico, SIN listas de nombres propios en el código ──────
  // Hasta el 28/09/2026 este fallback eran tres listas hardcodeadas
  // (SOCIAL_TAGS/PROJECT_TAGS/PERSONAL_TAGS) con nombres reales de familia y
  // amigos escritos a mano — exactamente el invariante §0 que B2 ya había
  // corregido en `profile.ts` ("el conocimiento vive en la BD, nunca en el
  // código"), sobrevivía aquí sin que nadie lo hubiera notado. Sin tags que
  // priorizar, la señal honesta que queda es importancia + recencia.
  //
  // `importance` es un enum de texto ('high'|'medium'|'low'): un `.sort({
  // importance: -1 })` directo ordena ALFABÉTICAMENTE ("medium" > "low" >
  // "high"), dejando lo de importancia alta al final — justo lo contrario de
  // lo que pide el comentario. Se traduce a un rango numérico en la propia
  // agregación para ordenar por el valor real.
  const fallback = await Memory.aggregate([
    { $addFields: { _rango: {
      $switch: {
        branches: [
          { case: { $eq: ['$importance', 'high'] },   then: 3 },
          { case: { $eq: ['$importance', 'medium'] }, then: 2 },
          { case: { $eq: ['$importance', 'low'] },    then: 1 },
        ],
        default: 0,
      },
    } } },
    { $sort: { _rango: -1, updatedAt: -1 } },
    { $limit: technicalLimit + 25 },
  ]) as unknown as IMemory[];
  medirContexto('fallback', fallback);
  return fallback;
}

/** B5.4 — medir cuánto contexto se gasta por respuesta y por qué vía se sirvió. */
function medirContexto(via: 'semántica' | 'fallback' | 'búsqueda', memories: IMemory[]): void {
  const chars = memories.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
  console.log(`📏 Contexto de memorias (${via}): ${memories.length} items, ${chars} chars`);
}

export async function searchMemories(query: string, opts?: { privado?: boolean }): Promise<IMemory[]> {
  // Búsqueda semántica — Atlas Vector Search con fallback al coseno en memoria
  try {
    const { vector, dim } = await generateEmbedding(query, opts);
    const scored = await buscarMemoriasSimilares(vector, dim, { minScore: 0.3, limit: 20 });
    if (scored.length >= 3) {
      medirContexto('búsqueda', scored.map(s => s.m));
      return scored.map(s => s.m);
    }
  } catch { /* fallback a keywords */ }

  // Fallback keyword
  const words = query.trim().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return Memory.find().sort({ createdAt: -1 }).limit(20);
  const regex = new RegExp(words.join('|'), 'i');
  return Memory.find({ content: regex }).sort({ importance: -1, createdAt: -1 }).limit(20);
}

export function formatMemoriesForPrompt(memories: IMemory[]): string {
  if (!memories.length) return '';
  return memories
    .map(m => {
      const fecha = new Date(m.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      return `• [${m.type}] ${m.content} (${fecha})`;
    })
    .join('\n');
}

export type ForgetResult = 'deleted' | 'protected' | 'not_found';

export async function forgetMemory(hint: string): Promise<ForgetResult> {
  const words = hint.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (!words.length) return 'not_found';
  const regex = new RegExp(words.join('|'), 'i');
  // Comprueba primero si existe (sin filtro de source)
  const exists = await Memory.findOne({ content: regex }).sort({ createdAt: -1 });
  if (!exists) return 'not_found';
  // Las memorias importadas (source=manual) son intocables via lenguaje natural
  if (exists.source === 'manual') return 'protected';
  await exists.deleteOne();
  return 'deleted';
}

function inferLocationFromRoutine(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const hora = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  if (!isWeekend && hora >= 7 && hora < 15) return 'Inetum, Donostia';
  return process.env.WEATHER_CITY ?? 'Errentería';
}

const ROUTINE_CITIES = /errenteria|errentería|donostia|donosti/i;

export async function getCurrentLocation(): Promise<string> {
  try {
    const mem = await Memory.findOne({ tags: 'ubicacion-actual' }).sort({ createdAt: -1 });
    if (mem) {
      const loc = mem.content.replace(/^ubicaci[oó]n\s+actual[^:]*:\s*/i, '').trim();
      const ageHours = (Date.now() - new Date(mem.createdAt).getTime()) / 3_600_000;
      // Ciudad de viaje (no rutinaria) → se respeta indefinidamente
      // Ciudad rutinaria (Errentería/Donostia) → solo si fue guardada en las últimas 4h
      if (!ROUTINE_CITIES.test(loc) || ageHours < 4) return loc;
    }
  } catch {}
  // Sin override reciente → inferir por horario y rutina
  return inferLocationFromRoutine();
}

const UPDATE_OR_CREATE_SYSTEM = `Tienes dos memorias del asistente BAKO sobre Borja. ¿La nueva información actualiza/reemplaza a la existente, o es información adicional diferente? Responde solo: ACTUALIZAR o CREAR`;

/**
 * 7b-D: guarda o actualiza según similitud semántica con memorias existentes.
 * `privado:true` (invariante §3.3) corta el fallback a la nube tanto del
 * embedding (Cloudflare) como de la decisión ACTUALIZAR/CREAR (Groq): si
 * Ollama no responde, se guarda como memoria nueva sin comparar en vez de
 * arriesgar una llamada fuera con contenido sensible.
 */
export async function deduplicateAndSave(entry: {
  content:    string;
  type:       IMemory['type'];
  importance: IMemory['importance'];
  tags:       string[];
}, opts?: { privado?: boolean }): Promise<void> {
  const privado = opts?.privado ?? false;
  try {
    const { vector, dim } = await generateEmbedding(entry.content, { privado });
    // `excluirManual` es un filtro NATIVO de Atlas (campo `source` declarado
    // como `filter` en el índice) — invariante §7: el clasificador nunca pisa
    // una memoria curada a mano, sin arriesgarse a que el mejor duplicado
    // no-manual quede fuera de una ventana de resultados pedida "de más".
    const similar = await buscarMemoriasSimilares(vector, dim, { minScore: 0.85, limit: 5, excluirManual: true });

    if (similar.length > 0) {
      const best = similar[0];
      const decision = await askClaude(
        `Existente: "${best.m.content}"\nNueva: "${entry.content}"`,
        { systemPrompt: UPDATE_OR_CREATE_SYSTEM, maxTokens: 10, ...(privado ? { private: true } : { useCloud: false }) }
      );
      if (decision.trim().toUpperCase().startsWith('ACTUALIZAR')) {
        await Memory.findByIdAndUpdate(best.m._id, {
          content:      entry.content,
          type:         entry.type,
          importance:   entry.importance,
          tags:         entry.tags,
          embedding:    vector,
          embeddingDim: dim,
        });
        console.log(`🔄 Memoria actualizada: "${entry.content}"`);
        return;
      }
    }
  } catch { /* fallback a crear nueva */ }

  await saveMemory(entry.content, {
    type:       entry.type,
    importance: entry.importance,
    source:     'extracted',
    tags:       entry.tags ?? [],
    privado,
  });
  console.log(`🧠 Memoria guardada: "${entry.content}"`);
}
