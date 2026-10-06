import { Router, Request, Response } from 'express';
import { askClaude, isOllamaAvailable, PrivacyError } from '../llm/claude';
import { Task } from '../memory/Task';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { validatePrompt, buildSafeSearchRegex, sanitizeString, sanitizeTags } from '../middleware/security';
import { getAllNotionProjects } from '../tools/notion';
import { syncNotionProjectsToMongo } from '../tools/projectSync';

const router = Router();

// POST /api/agent/ask
// Body: { "prompt": "tu pregunta o tarea" }
router.post('/ask', validatePrompt, async (req: Request, res: Response) => {
  const { prompt, private: isPrivate = false } = req.body;

  const task = await Task.create({ prompt, status: 'pending', isPrivate });
  console.log(`📨 Tarea ${isPrivate ? '🔒 privada' : 'normal'} [${task._id}]: ${prompt}`);

  try {
    const respuesta = await askClaude(prompt, { private: isPrivate });

    task.respuesta = respuesta;
    task.status = 'done';
    await task.save();

    console.log(`✅ Tarea completada [${task._id}]`);
    res.json({ ok: true, taskId: task._id, prompt, respuesta, private: isPrivate });

  } catch (error) {
    task.status = 'error';
    task.errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    await task.save();

    if (error instanceof PrivacyError) {
      console.warn(`🔒 Tarea privada bloqueada [${task._id}]: Ollama no disponible`);
      res.status(503).json({
        error: 'Ollama no disponible. Tarea privada no procesada.',
        hint: 'Arranca Ollama en tu PC o envía la tarea sin modo privado.',
        taskId: task._id,
      });
      return;
    }

    console.error(`❌ Tarea fallida [${task._id}]:`, error);
    res.status(500).json({ error: 'Error al procesar la tarea', taskId: task._id });
  }
});

// GET /api/agent/ollama-status
router.get('/ollama-status', async (_req: Request, res: Response) => {
  const available = await isOllamaAvailable();
  res.json({ ok: true, ollama: available ? 'online' : 'offline' });
});

// GET /api/agent/tasks — ver el historial de tareas
router.get('/tasks', async (_req: Request, res: Response) => {
  const tasks = await Task.find().sort({ createdAt: -1 }).limit(20);
  res.json({ ok: true, tasks });
});

// POST /api/agent/morning-briefing — ejecutar el Morning Briefing Agent
router.post('/morning-briefing', async (req: Request, res: Response) => {
  const speak = req.body?.speak ?? req.query.speak === 'true';
  const prompt = 'Morning Briefing — clima, noticias y proyectos';
  const task = await Task.create({ prompt, status: 'pending' });
  console.log(`🌅 Morning Briefing iniciado [${task._id}]`);

  try {
    const respuesta = await runMorningBriefing({ speak });

    task.respuesta = respuesta;
    task.status = 'done';
    await task.save();

    console.log(`✅ Morning Briefing completado [${task._id}]`);
    res.json({ ok: true, taskId: task._id, respuesta });

  } catch (error) {
    task.status = 'error';
    task.errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    await task.save();

    console.error(`❌ Morning Briefing fallido [${task._id}]:`, error);
    res.status(500).json({ error: 'Error al generar el briefing', taskId: task._id });
  }
});

// GET /api/agent/memories — listar todas las memorias
router.get('/memories', async (req: Request, res: Response) => {
  const { Memory } = await import('../memory/Memory');
  const q = req.query.q as string | undefined;
  let filter = {};
  if (q && typeof q === 'string' && q.trim().length > 0) {
    try {
      filter = { content: buildSafeSearchRegex(q.slice(0, 200)) };
    } catch {
      filter = {};
    }
  }
  const memories = await Memory.find(filter).sort({ importance: -1, createdAt: -1 });
  res.json({ ok: true, total: memories.length, memories });
});

// PUT /api/agent/memories/:id — editar memoria
router.put('/memories/:id', async (req: Request, res: Response) => {
  const { Memory } = await import('../memory/Memory');
  const { content, importance, type, tags } = req.body;
  const memory = await Memory.findById(req.params.id);
  if (!memory) { res.status(404).json({ error: 'Memoria no encontrada' }); return; }
  if (content    !== undefined) {
    if (typeof content !== 'string' || content.length > 2000) {
      res.status(400).json({ error: 'El contenido debe ser una cadena de máximo 2000 caracteres' }); return;
    }
    memory.content = sanitizeString(content, 2000);
  }
  if (importance !== undefined) memory.importance = importance;
  if (type       !== undefined) memory.type       = type;
  if (tags       !== undefined) memory.tags       = sanitizeTags(tags);
  await memory.save();
  res.json({ ok: true, memory });
});

// DELETE /api/agent/memories/:id — eliminar memoria por ID
router.delete('/memories/:id', async (req: Request, res: Response) => {
  const { Memory } = await import('../memory/Memory');
  const memory = await Memory.findByIdAndDelete(req.params.id);
  if (!memory) { res.status(404).json({ error: 'Memoria no encontrada' }); return; }
  res.json({ ok: true, deleted: req.params.id });
});

// POST /api/agent/deduplicate-memories — deduplicación algorítmica (sin LLM)
// Body: { dry_run?: boolean }  — si dry_run=true devuelve el plan sin ejecutar
router.post('/deduplicate-memories', async (req: Request, res: Response) => {
  const dryRun = req.body?.dry_run === true;
  const { Memory } = await import('../memory/Memory');

  let memories: any[];
  try {
    memories = await Memory.find({}).sort({ createdAt: 1 });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo memorias', detail: (err as Error).message });
    return;
  }

  if (!memories.length) {
    res.json({ ok: true, message: 'No hay memorias', deleted: 0, merged: 0 });
    return;
  }

  // Normaliza texto para comparación: minúsculas, sin acentos, espacios simples
  const norm = (s: string): string =>
    String(s || '').toLowerCase().trim()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
      .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o')
      .replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/\s+/g, ' ');

  const toDelete = new Set<string>();
  const plan: Array<{ keep_id: string; delete_ids: string[]; razon: string; keep_preview: string }> = [];

  // Pase 1: agrupar por prefijo normalizado (primeros 100 chars) — duplicados obvios
  const prefixGroups: Map<string, any[]> = new Map();
  for (const m of memories) {
    const key = norm(m.content || '').slice(0, 100);
    if (!key) continue;
    const g = prefixGroups.get(key) || [];
    g.push(m);
    prefixGroups.set(key, g);
  }
  for (const [, group] of prefixGroups) {
    if (group.length < 2) continue;
    // Conservar la que tenga más tags; en empate, la de contenido más largo
    group.sort((a, b) => {
      const tagDiff = (b.tags?.length || 0) - (a.tags?.length || 0);
      if (tagDiff !== 0) return tagDiff;
      return (b.content?.length || 0) - (a.content?.length || 0);
    });
    const keeper = group[0];
    const dups = group.slice(1);
    dups.forEach(d => toDelete.add(String(d._id)));
    plan.push({
      keep_id: String(keeper._id),
      delete_ids: dups.map(d => String(d._id)),
      razon: 'contenido idéntico (prefijo 100 chars)',
      keep_preview: String(keeper.content || '').slice(0, 100),
    });
  }

  // Pase 2: eliminar memorias basura (test, vacías, "sin recuerdos", etc.)
  const JUNK = [/^test$/i, /^$/, /^sin recuerdos/i, /^no hay registro/i, /^sin registro/i, /^n\/a$/i];
  for (const m of memories) {
    const c = String(m.content || '').trim();
    if (JUNK.some(p => p.test(c))) toDelete.add(String(m._id));
  }

  // Pase 3: detección de subconjuntos por solapamiento de palabras (>85%)
  // Si las palabras clave de A están casi todas en B (y B es más largo), A es redundante
  const wordSet = (s: string): Set<string> =>
    new Set(norm(s).split(/\s+/).filter(w => w.length > 3));

  for (const ma of memories) {
    const idA = String(ma._id);
    if (toDelete.has(idA)) continue;
    const wordsA = wordSet(ma.content || '');
    if (wordsA.size < 8) continue; // saltar memorias muy cortas

    for (const mb of memories) {
      const idB = String(mb._id);
      if (idA === idB || toDelete.has(idB)) continue;
      const normB = norm(mb.content || '');
      const normA = norm(ma.content || '');
      if (normB.length <= normA.length * 1.1) continue; // B debe ser notablemente más largo

      const wordsB = wordSet(mb.content || '');
      const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
      if (overlap / wordsA.size > 0.88) {
        toDelete.add(idA);
        plan.push({
          keep_id: idB,
          delete_ids: [idA],
          razon: `subconjunto (${Math.round(overlap / wordsA.size * 100)}% palabras contenidas en memoria más completa)`,
          keep_preview: String(mb.content || '').slice(0, 100),
        });
        break;
      }
    }
  }

  const totalWillDelete = toDelete.size;

  if (dryRun) {
    res.json({
      ok: true, dry_run: true,
      memorias_total: memories.length,
      grupos_detectados: plan.length,
      total_eliminaciones: totalWillDelete,
      memorias_resultado: memories.length - totalWillDelete,
      plan: plan.slice(0, 30).map(g => ({
        delete_count: g.delete_ids.length,
        razon: g.razon,
        keep_preview: g.keep_preview + '…',
      })),
    });
    return;
  }

  let deleted = 0;
  for (const id of toDelete) {
    try { const d = await Memory.findByIdAndDelete(id); if (d) deleted++; } catch { /* skip */ }
  }

  const memorias_despues = await Memory.countDocuments();
  console.log(`🧹 deduplicate-memories: ${deleted} eliminadas. ${memories.length} → ${memorias_despues}`);

  res.json({
    ok: true,
    memorias_antes: memories.length,
    memorias_despues,
    grupos_fusionados: plan.length,
    eliminadas: deleted,
  });
});

// POST /api/agent/memories/import — importar memorias en batch
router.post('/memories/import', async (req: Request, res: Response) => {
  const { memories } = req.body;
  if (!Array.isArray(memories) || memories.length === 0) {
    res.status(400).json({ error: 'memories debe ser un array no vacío' });
    return;
  }
  if (memories.length > 200) {
    res.status(400).json({ error: 'Máximo 200 memorias por importación' });
    return;
  }
  const { saveMemory } = await import('../tools/memory');
  const results = [];
  for (const m of memories) {
    if (!m.content || typeof m.content !== 'string') continue;
    const content = sanitizeString(m.content, 2000);
    if (!content) continue;
    const saved = await saveMemory(content, {
      type:       m.type,
      importance: m.importance,
      source:     'manual',
      tags:       sanitizeTags(m.tags),
    });
    results.push({ id: String(saved._id), content: content.slice(0, 60) });
  }
  res.json({ ok: true, saved: results.length, memories: results });
});

// POST /api/agent/sync-notion-projects — refresca el espejo de proyectos desde Notion
// Notion es la fuente de verdad. Solo añade y actualiza: nunca borra de Mongo.
router.post('/sync-notion-projects', async (_req: Request, res: Response) => {
  try {
    const projects = await getAllNotionProjects();
    const result   = await syncNotionProjectsToMongo(projects);
    console.log(`🔧 sync-notion-projects: +${result.created} creados, ${result.updated} actualizados`);
    res.json({ ok: true, total: projects.length, ...result });
  } catch (err) {
    res.status(502).json({ error: 'No pude leer los proyectos de Notion', detail: (err as Error).message });
  }
});

export default router;