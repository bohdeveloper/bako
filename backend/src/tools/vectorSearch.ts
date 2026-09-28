/**
 * B5 del plan — recuperación a escala con MongoDB Atlas Vector Search.
 *
 * Hasta ahora `getMemories`/`searchMemories`/`deduplicateAndSave` cargaban
 * TODAS las memorias de Mongo y calculaban el coseno en Node en cada consulta
 * (`tools/embeddings.ts#cosineSimilarity`) — correcto con 100 registros,
 * insostenible con 10.000. Atlas Vector Search (disponible en el plan free M0,
 * invariante §1 de coste $0) hace la búsqueda por vecino más cercano dentro
 * del propio cluster, sin traer nada a Node.
 *
 * Hay DOS modelos de embedding en juego (`tools/embeddings.ts`): `nomic-embed-
 * text` de Ollama (768 dims) y `bge-small-en-v1.5` de Cloudflare Workers AI
 * (384 dims, solo cuando Ollama no responde). Un índice de Atlas Search fija
 * `numDimensions` una sola vez, así que hacen falta DOS índices sobre el mismo
 * campo `embedding` — se elige uno u otro según la dimensión del vector de la
 * consulta, igual que antes se filtraba `Memory.find({ embeddingDim: dim })`.
 *
 * Todo tiene fallback al cálculo en memoria: un cluster que no sea Atlas (Mongo
 * local, mongodb-memory-server en tests) o un índice que aún esté construyéndose
 * no debe romper la búsqueda — solo la hace más lenta, que es la situación de
 * la que se viene.
 */
import { Memory, IMemory } from '../memory/Memory';
import { cosineSimilarity } from './embeddings';

interface DimIndex { dim: number; name: string }
const VECTOR_INDEXES: DimIndex[] = [
  { dim: 768, name: 'memory_vector_768' }, // nomic-embed-text (Ollama)
  { dim: 384, name: 'memory_vector_384' }, // bge-small-en-v1.5 (Cloudflare)
];

// Se comprueba una vez por proceso, no en cada búsqueda: `listSearchIndexes()`
// es una llamada de más por consulta que no aporta nada una vez confirmado.
let atlasDisponible: boolean | null = null;

// Por dimensión: ¿ya se confirmó que el índice está `queryable`? Una vez que
// sí (por una respuesta con resultados, o por `listSearchIndexes` diciéndolo),
// se cachea — sin esto, cualquier búsqueda con 0 resultados POR ENCIMA de esa
// escala (justo la que motiva migrar a Atlas) caería al escaneo completo en
// Node cada vez, derrotando el propósito de la migración.
const indiceListo = new Map<number, boolean>();

async function indiceConfirmadoListo(idx: DimIndex): Promise<boolean> {
  if (indiceListo.get(idx.dim)) return true;
  try {
    const info = await Memory.collection.listSearchIndexes(idx.name).toArray() as any[];
    const listo = info[0]?.queryable === true;
    if (listo) indiceListo.set(idx.dim, true);
    return listo;
  } catch {
    return false;
  }
}

/**
 * Crea los índices de Atlas Search que falten (idempotente: `listSearchIndexes`
 * primero, para no reintentar crear uno que ya existe). Se llama una vez al
 * arrancar el servidor, en background — no debe retrasar ni romper el arranque
 * si el cluster no es Atlas o no tiene Search habilitado (M0 sí lo tiene desde
 * 2023, pero un Mongo local de desarrollo no).
 */
export async function ensureVectorSearchIndexes(): Promise<void> {
  try {
    const coll = Memory.collection;
    const existentes = await coll.listSearchIndexes().toArray().catch(() => null);
    if (existentes === null) {
      // El propio listado falla en un Mongo que no soporta Search (no-Atlas).
      atlasDisponible = false;
      console.log('📏 Atlas Search no disponible en este cluster — se usa coseno en memoria');
      return;
    }
    const nombres = new Set(existentes.map((i: any) => i.name));
    for (const idx of VECTOR_INDEXES) {
      if (nombres.has(idx.name)) continue;
      await coll.createSearchIndex({
        name: idx.name,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: 'embedding', numDimensions: idx.dim, similarity: 'cosine' },
            // Declarado como filtro para que `deduplicateAndSave` pueda excluir
            // `source:'manual'` DENTRO de la propia búsqueda (invariante §7) —
            // sin esto habría que pedir de más y filtrar después, arriesgando
            // perder el mejor duplicado no-manual si hay ≥N manuales por delante.
            { type: 'filter', path: 'source' },
          ],
        },
      });
      console.log(`📏 Índice Atlas Vector Search creado: ${idx.name} (${idx.dim} dims) — tarda unos minutos en quedar listo`);
    }
    atlasDisponible = true;
  } catch (err) {
    atlasDisponible = false;
    console.warn('📏 No se pudieron crear/verificar los índices de Atlas Vector Search:', (err as Error).message);
  }
}

/** Cosine en memoria — el camino que ya existía, usado como fallback. */
async function busquedaEnMemoria(
  vector: number[], dim: number, minScore: number, limit: number, excluirManual: boolean,
): Promise<Array<{ m: IMemory; score: number }>> {
  const filtro: Record<string, any> = { embeddingDim: dim };
  // Coincidencia exacta con 'extracted', no `$ne:'manual'`: si algún documento
  // llegara sin `source` (bypaseando el default del esquema), `$ne` lo dejaría
  // pasar aquí pero el camino de Atlas (`$eq:'extracted'`) lo excluiría — la
  // misma búsqueda daría un resultado distinto según si Atlas está disponible
  // o no, justo lo que este fallback dice no hacer.
  if (excluirManual) filtro.source = 'extracted';
  const candidates = await Memory.find(filtro).lean() as any[];
  return candidates
    .map((m: any) => ({ m: m as IMemory, score: cosineSimilarity(vector, m.embedding ?? []) }))
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Busca las memorias más parecidas a `vector` (misma dimensión `dim`).
 * Intenta Atlas Vector Search primero; si el índice no existe todavía, no está
 * listo, o el cluster no es Atlas, cae al coseno en memoria SIN que el
 * llamador tenga que saberlo — mismo contrato que antes (`{m, score}[]`).
 * `excluirManual` (invariante §7) se aplica como PRE-filtro nativo de Atlas —
 * el campo `source` está declarado como `filter` en el índice — para no tener
 * que pedir de más y descartar después, que podría perder el mejor duplicado
 * no-manual si hay más de `limit` manuales por delante en el ranking.
 */
export async function buscarMemoriasSimilares(
  vector: number[], dim: number,
  opts: { minScore?: number; limit?: number; excluirManual?: boolean } = {},
): Promise<Array<{ m: IMemory; score: number }>> {
  const minScore = opts.minScore ?? 0.15;
  const limit    = opts.limit    ?? 20;
  const excluirManual = opts.excluirManual ?? false;
  const idx = VECTOR_INDEXES.find(i => i.dim === dim);

  if (atlasDisponible !== false && idx) {
    try {
      const numCandidates = Math.max(limit * 10, 150); // recomendado por Atlas: ~10x el límite
      const resultados = await Memory.aggregate([
        {
          $vectorSearch: {
            index: idx.name, path: 'embedding', queryVector: vector,
            numCandidates, limit,
            // `$eq` en vez de `$ne`: el operador que el prefiltro de
            // `$vectorSearch` soporta con total seguridad en todas las
            // versiones. `MemorySource` es un enum cerrado de solo dos valores
            // ('manual'|'extracted'), así que "no manual" y "extracted" son
            // equivalentes — si el día de mañana se añade un tercer valor, esta
            // línea hay que revisarla.
            ...(excluirManual ? { filter: { source: { $eq: 'extracted' } } } : {}),
          },
        },
        // Atlas normaliza `vectorSearchScore` a [0,1] para similitud coseno
        // como (1+coseno)/2 — una escala DISTINTA del coseno crudo en [-1,1]
        // que devuelve `cosineSimilarity()` en el fallback de abajo. Sin
        // deshacer esa normalización aquí, los mismos `minScore` (0.15/0.3/
        // 0.85, pensados en escala de coseno crudo) significarían un umbral de
        // similitud real más bajo con Atlas que sin él — el propio criterio de
        // "es un duplicado" cambiaría según si el índice está listo o no.
        // Hallazgo de /code-review 28/09/2026.
        { $addFields: { score: { $subtract: [{ $multiply: [{ $meta: 'vectorSearchScore' }, 2] }, 1] } } },
        { $match: { score: { $gte: minScore } } },
      ]);
      if (resultados.length > 0) {
        atlasDisponible = true;
        indiceListo.set(dim, true); // si devolvió algo, seguro que ya está listo
        return resultados.map((m: any) => ({ m: m as IMemory, score: m.score }));
      }
      // 0 resultados: legítimo si el índice ya está confirmado `queryable` (a
      // esa escala, es justo el caso normal — nada por encima de `minScore`).
      // Solo es sospechoso mientras el índice sigue construyéndose, y esa
      // comprobación se cachea en cuanto se confirma, así que no se repite el
      // escaneo completo en cada búsqueda vacía una vez el índice ya calentó.
      if (await indiceConfirmadoListo(idx)) { atlasDisponible = true; return []; }
    } catch {
      // Índice inexistente/no listo, o cluster sin Search — fallback silencioso.
    }
  }
  return busquedaEnMemoria(vector, dim, minScore, limit, excluirManual);
}
