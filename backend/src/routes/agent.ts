import { Router, Request, Response } from 'express';
import { askClaude, isOllamaAvailable, PrivacyError } from '../llm/claude';
import { Task } from '../memory/Task';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';

const router = Router();

// POST /api/agent/ask
// Body: { "prompt": "tu pregunta o tarea" }
router.post('/ask', async (req: Request, res: Response) => {
  const { prompt, private: isPrivate = false } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'El campo prompt es obligatorio y no puede estar vacío' });
    return;
  }

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
  const filter = q ? { content: new RegExp(q.split(' ').filter(w => w.length > 2).join('|'), 'i') } : {};
  const memories = await Memory.find(filter).sort({ importance: -1, createdAt: -1 });
  res.json({ ok: true, total: memories.length, memories });
});

// PUT /api/agent/memories/:id — editar memoria
router.put('/memories/:id', async (req: Request, res: Response) => {
  const { Memory } = await import('../memory/Memory');
  const { content, importance, type, tags } = req.body;
  const memory = await Memory.findById(req.params.id);
  if (!memory) { res.status(404).json({ error: 'Memoria no encontrada' }); return; }
  if (content    !== undefined) memory.content    = content;
  if (importance !== undefined) memory.importance = importance;
  if (type       !== undefined) memory.type       = type;
  if (tags       !== undefined) memory.tags       = Array.isArray(tags) ? tags : String(tags).split(',').map((t: string) => t.trim()).filter(Boolean);
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

// POST /api/agent/migrate-memories — procesa memorias en lotes, sanitiza enums, maneja errores
router.post('/migrate-memories', async (_req: Request, res: Response) => {
  const { Memory }         = await import('../memory/Memory');
  const { Person }         = await import('../memory/Person');
  const { Project }        = await import('../memory/Project');
  const { KnowledgeEntry } = await import('../memory/KnowledgeEntry');

  let memories: any[];
  try {
    memories = await Memory.find({}).sort({ importance: -1, createdAt: -1 });
  } catch (err) {
    res.status(500).json({ error: 'Error al leer memorias de MongoDB', detail: (err as Error).message });
    return;
  }

  if (!memories.length) {
    res.json({ ok: true, message: 'No hay memorias', people: 0, projects: 0, knowledge: 0 });
    return;
  }

  // Valores válidos de enum por colección
  const RELACIONES   = ['pareja','familiar','amigo','compañero','conocido','otro'];
  const ESTADOS      = ['activo','diferido','completado','pausado','abandonado'];
  const PRIORIDADES  = ['alta','media','baja'];
  const CATEGORIAS   = ['salud','valores','caracter','finanzas','historia','rutina','objetivos','legal','hobbies','otro'];
  const IMPORTANCIAS = ['alta','media','baja'];

  const fixEnum = (v: any, valid: string[], fb: string) => {
    const s = String(v || '').trim().toLowerCase();
    return valid.includes(s) ? s : fb;
  };

  const SCHEMA = `{"people":[{"nombre":"","relacion":"pareja|familiar|amigo|compañero|conocido|otro","descripcion":"","cumpleaños":"DD-MM","ubicacion":"","trabajo":"","notas":[],"conexiones":[]}],"projects":[{"nombre":"","slug":"kebab","tipo":"","estado":"activo|diferido|completado|pausado|abandonado","prioridad":"alta|media|baja","descripcion":"","siguiente_accion":"","stack":[],"horizonte":"","notas":[]}],"knowledge":[{"categoria":"salud|valores|caracter|finanzas|historia|rutina|objetivos|legal|hobbies|otro","clave":"snake_case","valor":"","detalles":[],"importancia":"alta|media|baja"}]}`;

  const BATCH = 50;
  const col = { people: [] as any[], projects: [] as any[], knowledge: [] as any[] };
  let batchesOk = 0;

  // Helper de merge sin genéricos TypeScript
  const merge = (dest: any[], items: any[], getKey: (x: any) => string) => {
    for (const item of (items || [])) {
      const k = getKey(item)?.toString().trim().toLowerCase();
      if (!k) continue;
      const idx = dest.findIndex(x => getKey(x)?.toString().trim().toLowerCase() === k);
      if (idx === -1) dest.push(item);
      else if (JSON.stringify(item).length > JSON.stringify(dest[idx]).length) Object.assign(dest[idx], item);
    }
  };

  for (let i = 0; i < memories.length; i += BATCH) {
    const batch      = memories.slice(i, i + BATCH);
    const batchNum   = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(memories.length / BATCH);

    const memList = batch
      .map((m: any) => `${(m.tags || []).slice(0, 3).join(',')}|${String(m.content || '').slice(0, 200)}`)
      .join('\n');

    const prompt = `Extrae datos estructurados de estas ${batch.length} memorias de Borja (lote ${batchNum}/${totalBatches}).
Solo extrae lo explícito. Personas con nombre propio. Proyectos software/negocio. Conocimiento personal.
Cumpleaños DD-MM. Slug kebab-case. Clave snake_case. Arrays vacíos si no hay datos.
Responde ÚNICAMENTE JSON válido: ${SCHEMA}

MEMORIAS:
${memList}`;

    let raw: string;
    try {
      raw = await askClaude(prompt, { useCloud: true, maxTokens: 2500, temperature: 0 });
    } catch (err) {
      console.error(`Lote ${batchNum}/${totalBatches} error LLM:`, (err as Error).message);
      continue;
    }

    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) { console.warn(`Lote ${batchNum}: sin JSON válido`); continue; }

    let ext: any;
    try { ext = JSON.parse(m[0]); } catch { console.warn(`Lote ${batchNum}: JSON parse error`); continue; }

    merge(col.people,    ext.people,    (x: any) => x.nombre);
    merge(col.projects,  ext.projects,  (x: any) => x.slug || String(x.nombre || '').toLowerCase().replace(/\s+/g, '-'));
    merge(col.knowledge, ext.knowledge, (x: any) => x.clave);
    batchesOk++;
  }

  // Insertar en Atlas — idempotente + sanitización de enums + try/catch individual
  let pC = 0, pS = 0, pE = 0;
  let rC = 0, rS = 0, rE = 0;
  let kC = 0, kS = 0, kE = 0;

  for (const p of col.people) {
    if (!p.nombre?.trim()) continue;
    try {
      const safe = { ...p, relacion: fixEnum(p.relacion, RELACIONES, 'conocido') };
      const esc  = p.nombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ok   = await Person.findOne({ nombre: new RegExp(`^${esc}$`, 'i') });
      if (ok) { pS++; } else { await Person.create(safe); pC++; }
    } catch (e) { console.error(`Person.create(${p.nombre}):`, (e as Error).message); pE++; }
  }

  for (const p of col.projects) {
    if (!p.nombre?.trim()) continue;
    try {
      const slug = (p.slug?.trim() || p.nombre.trim().toLowerCase().replace(/\s+/g, '-'));
      const safe = { ...p, slug, estado: fixEnum(p.estado, ESTADOS, 'activo'), prioridad: fixEnum(p.prioridad, PRIORIDADES, 'media') };
      const ok   = await Project.findOne({ slug });
      if (ok) { rS++; } else { await Project.create(safe); rC++; }
    } catch (e) { console.error(`Project.create(${p.nombre}):`, (e as Error).message); rE++; }
  }

  for (const k of col.knowledge) {
    if (!k.clave?.trim()) continue;
    try {
      const safe = { ...k, clave: k.clave.trim(), fuente: 'extracted', categoria: fixEnum(k.categoria, CATEGORIAS, 'otro'), importancia: fixEnum(k.importancia, IMPORTANCIAS, 'media') };
      const ok   = await KnowledgeEntry.findOne({ clave: safe.clave });
      if (ok) { kS++; } else { await KnowledgeEntry.create(safe); kC++; }
    } catch (e) { console.error(`Knowledge.create(${k.clave}):`, (e as Error).message); kE++; }
  }

  console.log(`🧠 migrate-memories: ${batchesOk}/${Math.ceil(memories.length / BATCH)} lotes ok · p+${pC}(e${pE}) r+${rC}(e${rE}) k+${kC}(e${kE})`);
  res.json({
    ok: true,
    memorias_leidas: memories.length,
    lotes: `${batchesOk}/${Math.ceil(memories.length / BATCH)}`,
    people:    { created: pC, skipped: pS, errors: pE, total: col.people.length },
    projects:  { created: rC, skipped: rS, errors: rE, total: col.projects.length },
    knowledge: { created: kC, skipped: kS, errors: kE, total: col.knowledge.length },
  });
});

// POST /api/agent/deduplicate-memories — analiza memorias con LLM, fusiona duplicados y elimina redundantes
// Body: { dry_run?: boolean }  — si dry_run=true devuelve el plan sin ejecutar
router.post('/deduplicate-memories', async (req: Request, res: Response) => {
  const dryRun = req.body?.dry_run === true;
  const { Memory } = await import('../memory/Memory');

  const memories = await Memory.find({}).sort({ createdAt: 1 });
  if (!memories.length) {
    res.json({ ok: true, message: 'No hay memorias', deleted: 0, merged: 0 });
    return;
  }

  // Mapa de índice corto → MongoDB ID (el LLM trabaja con #N para reducir tamaño del payload)
  const idxToId: Record<number, string> = {};
  const memList = memories
    .map((m, i) => {
      idxToId[i + 1] = String(m._id);
      return `#${i + 1}|${(m.tags || []).slice(0, 3).join(',')}|${m.content.slice(0, 150)}`;
    })
    .join('\n');

  const prompt = `Experto en gestión del conocimiento. Analiza estas ${memories.length} memorias de Borja e identifica duplicados.

CRITERIOS:
- DUPLICADO: misma información, diferente redacción → fusionar, borrar las demás
- SUBCONJUNTO: una tiene TODA la info de otra y más → eliminar la menor
- TEST/VACÍO/INÚTIL: eliminar directamente
- COMPLEMENTARIAS: mismo tema, info única cada una → conservar o fusionar
- DUDA: conservar ambas

En merged_content incluye TODA la información única de todas las memorias del grupo.
Usa los índices #N EXACTAMENTE como aparecen.

JSON válido sin texto extra:
{"merge_groups":[{"keep_idx":1,"merged_content":"texto completo","merged_tags":["t1"],"delete_idxs":[2,3],"razon":""}],"delete_standalone":[4]}

Sin duplicados: {"merge_groups":[],"delete_standalone":[]}

MEMORIAS:
${memList}`;

  let raw: string;
  try {
    raw = await askClaude(prompt, { useCloud: true, maxTokens: 6000, temperature: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Error llamando al LLM', detail: (err as Error).message });
    return;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    res.status(500).json({ error: 'LLM no devolvió JSON válido', preview: raw.slice(0, 400) });
    return;
  }

  // El LLM devuelve índices cortos (#N) — traducir a MongoDB IDs
  let plan: { merge_groups?: any[]; delete_standalone?: number[] };
  try { plan = JSON.parse(jsonMatch[0]); }
  catch { res.status(500).json({ error: 'JSON inválido en respuesta LLM', preview: jsonMatch[0].slice(0, 400) }); return; }

  const mergeGroups      = plan.merge_groups      || [];
  const deleteStandalone = plan.delete_standalone || [];
  const totalWillDelete  = mergeGroups.reduce((n: number, g: any) => n + (g.delete_idxs?.length || 0), 0) + deleteStandalone.length;

  if (dryRun) {
    res.json({
      ok: true, dry_run: true,
      memorias_total: memories.length,
      grupos_a_fusionar: mergeGroups.length,
      a_eliminar_standalone: deleteStandalone.length,
      total_eliminaciones: totalWillDelete,
      memorias_resultado: memories.length - totalWillDelete,
      plan: mergeGroups.map((g: any) => ({
        keep_idx: g.keep_idx,
        merged_preview: (g.merged_content || '').slice(0, 120) + '…',
        delete_count: g.delete_idxs?.length || 0,
        razon: g.razon,
      })),
    });
    return;
  }

  let merged = 0, deleted = 0;

  for (const g of mergeGroups) {
    if (!g.keep_idx) continue;
    const keepId = idxToId[g.keep_idx];
    if (!keepId) continue;
    try {
      await Memory.findByIdAndUpdate(keepId, {
        content: g.merged_content || '',
        tags: Array.isArray(g.merged_tags) ? g.merged_tags : [],
      });
      for (const delIdx of (g.delete_idxs || [])) {
        const delId = idxToId[delIdx];
        if (!delId) continue;
        try { const d = await Memory.findByIdAndDelete(delId); if (d) deleted++; } catch { /* skip */ }
      }
      merged++;
    } catch { /* skip */ }
  }

  for (const idx of deleteStandalone) {
    const delId = idxToId[idx];
    if (!delId) continue;
    try { const d = await Memory.findByIdAndDelete(delId); if (d) deleted++; } catch { /* skip */ }
  }

  const memorias_despues = await Memory.countDocuments();
  console.log(`🧹 deduplicate-memories: ${merged} fusionadas, ${deleted} eliminadas. ${memories.length} → ${memorias_despues}`);

  res.json({
    ok: true,
    memorias_antes: memories.length,
    memorias_despues,
    fusionadas: merged,
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
  const { saveMemory } = await import('../tools/memory');
  const results = [];
  for (const m of memories) {
    if (!m.content) continue;
    const saved = await saveMemory(m.content, {
      type:       m.type,
      importance: m.importance,
      source:     'manual',
      tags:       m.tags ?? [],
    });
    results.push({ id: String(saved._id), content: m.content.slice(0, 60) });
  }
  res.json({ ok: true, saved: results.length, memories: results });
});

export default router;