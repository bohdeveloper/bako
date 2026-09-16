import { Memory, IMemory } from '../memory/Memory';
import { askClaude } from '../llm/claude';
import { generateEmbedding, cosineSimilarity } from './embeddings';

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

// ── Tier 1: relaciones sociales — SIEMPRE completas (familia, amigos, pareja)
const SOCIAL_TAGS = [
  'familia', 'amigos', 'familia-politica', 'pareja',
  'suegros', 'cuniada', 'cuniado', 'hermana', 'padre', 'madre', 'padres', 'yaimy',
  'paula', 'julen', 'ibon', 'sofi', 'nati', 'elena', 'oscar', 'osvaldo',
];

// ── Tier 2: proyectos clave — siempre garantizados
const PROJECT_TAGS = [
  'bako', 'diamadmin', 'unyona', 'kefir', 'ai-personal-os', 'matrix-game',
  'bohdeveloper', 'ingresos-pasivos', 'robotica', 'busqueda-empleo', 'proyectos',
];

// ── Tier 3: contexto personal (salud, valores, historia, etc.)
const PERSONAL_TAGS = [
  'salud', 'gustos', 'historia', 'motivacion', 'valores', 'objetivos',
  'finanzas', 'caracter', 'rutina', 'entrenamiento', 'lae', 'correccion',
  'judicial', 'psicologo', 'hobbies', 'suenos', 'miedos', 'transformacion',
];

export async function getMemories(
  technicalLimit = 2,
  _personalLimit = 44,  // ignorado — ahora usamos tiers o semántica
  query?: string,       // 7b-C: si se pasa, usa búsqueda semántica en lugar de tiers
  // §3.3: hasta el 16/09/2026 esta función no sabía de privacidad — un turno
  // sensible ("mi nómina de Inetum") con Ollama arriba pero su modelo de
  // embeddings caído se embebía igual vía Cloudflare, porque `generateEmbedding`
  // solo corta ese fallback si alguien le pasa `privado:true` explícitamente.
  // Encontrado en /code-review al revisar el gate de voz de Telegram.
  privado = false,
): Promise<IMemory[]> {
  // ── 7b-C: búsqueda semántica cuando hay query y embeddings suficientes ───────
  if (query) {
    try {
      const { vector, dim } = await generateEmbedding(query, { privado });
      const candidates = await Memory.find({ embeddingDim: dim }).lean() as any[];
      if (candidates.length >= 10) {
        const scored = candidates
          .map((m: any) => ({ m, score: cosineSimilarity(vector, m.embedding ?? []) }))
          .filter(s => s.score > 0.15)
          .sort((a, b) => b.score - a.score);
        if (scored.length >= 5) {
          console.log(`🔍 Memoria semántica: top ${Math.min(scored.length, 15)} de ${candidates.length} candidatas (dim=${dim})`);
          return scored.slice(0, 15).map(s => s.m as IMemory);
        }
      }
    } catch { /* fallback a tiers si falla el embedding */ }
  }

  // ── Fallback: sistema de tiers heurístico ────────────────────────────────────
  // Tier 1 — familia, amigos, pareja: SIEMPRE primeros (top 20)
  const social = await Memory.find({ tags: { $in: SOCIAL_TAGS } })
    .sort({ importance: -1, updatedAt: -1 }).limit(20);

  const socialIds = social.map(m => (m as any)._id);

  // Tier 2 — proyectos clave: top 5
  const projects = await Memory.find({
    _id:  { $nin: socialIds },
    tags: { $in: PROJECT_TAGS },
  }).sort({ importance: -1, updatedAt: -1 }).limit(5);

  const projectIds = projects.map(m => (m as any)._id);

  // Tier 3 — contexto personal: top 3
  const personal = await Memory.find({
    _id:  { $nin: [...socialIds, ...projectIds] },
    tags: { $in: PERSONAL_TAGS },
  }).sort({ importance: -1, updatedAt: -1 }).limit(3);

  const personalIds = personal.map(m => (m as any)._id);

  // Tier 4 — técnico: según límite
  const technical = await Memory.find({
    _id: { $nin: [...socialIds, ...projectIds, ...personalIds] },
  }).sort({ updatedAt: -1 }).limit(technicalLimit);

  return [...social, ...projects, ...personal, ...technical];
}

export async function searchMemories(query: string, opts?: { privado?: boolean }): Promise<IMemory[]> {
  // Búsqueda semántica — si hay embeddings disponibles, usarlos
  try {
    const { vector, dim } = await generateEmbedding(query, opts);
    const candidates = await Memory.find({ embeddingDim: dim }).lean() as any[];
    if (candidates.length >= 3) {
      const scored = candidates
        .map((m: any) => ({ m, score: cosineSimilarity(vector, m.embedding ?? []) }))
        .filter(s => s.score > 0.3)
        .sort((a, b) => b.score - a.score);
      if (scored.length >= 3) {
        console.log(`🔍 Búsqueda semántica: ${scored.length} candidatas (dim=${dim})`);
        return scored.slice(0, 20).map(s => s.m);
      }
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
    const candidates = await Memory.find({ embeddingDim: dim, source: { $ne: 'manual' } }).lean() as any[];
    const similar = candidates
      .map((m: any) => ({ m, score: cosineSimilarity(vector, m.embedding ?? []) }))
      .filter(s => s.score >= 0.85)
      .sort((a, b) => b.score - a.score);

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
