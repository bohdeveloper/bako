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

// POST /api/agent/migrate-memories — lee las memorias, extrae datos estructurados con LLM
//   y pobla People, Projects y KnowledgeEntry sin tocar las memorias originales
router.post('/migrate-memories', async (_req: Request, res: Response) => {
  const { Memory }        = await import('../memory/Memory');
  const { Person }        = await import('../memory/Person');
  const { Project }       = await import('../memory/Project');
  const { KnowledgeEntry }= await import('../memory/KnowledgeEntry');
  const { askClaude }     = await import('../llm/claude');

  // 1. Leer todas las memorias
  const memories = await Memory.find({}).sort({ importance: -1, createdAt: -1 });
  if (!memories.length) {
    res.json({ ok: true, message: 'No hay memorias', people: 0, projects: 0, knowledge: 0 });
    return;
  }

  // 2. Construir la lista para el prompt
  const memList = memories
    .map((m, i) => `[${i + 1}] [${m.tags?.join(',') || 'sin-tags'}] ${m.content}`)
    .join('\n');

  const extractPrompt = `Eres un extractor de datos estructurados para la base de datos de BAKO, el sistema personal de Borja.

Analiza TODAS estas memorias y extrae TODA la información para poblar tres colecciones. Lee con atención — muchas memorias contienen datos parciales que juntos forman un perfil completo.

REGLAS:
- Extrae SOLO lo que está explícitamente en las memorias
- PERSONAS: solo las que tengan nombre propio mencionado
- PROYECTOS: solo proyectos de software, negocio o emprendimiento concretos
- CONOCIMIENTO: hechos sobre salud, finanzas, valores, carácter, historia personal, rutina, objetivos vitales, asuntos legales, hobbies
- Agrupa información dispersa sobre la misma entidad en un solo registro
- Para cumpleaños usa formato DD-MM (ej: 15-08). Si solo hay mes, déjalo vacío
- Para slug usa kebab-case corto (ej: "bako", "matrix-game")
- Para clave usa snake_case descriptivo (ej: "digestivo_gluten", "ahorro_meta_2026")

Responde ÚNICAMENTE con JSON válido sin texto extra:
{
  "people": [{
    "nombre": "string",
    "relacion": "pareja|familiar|amigo|compañero|conocido|otro",
    "descripcion": "una frase que define quién es",
    "cumpleaños": "DD-MM o vacío",
    "ubicacion": "ciudad",
    "trabajo": "profesión o empresa",
    "notas": ["observaciones relevantes"],
    "conexiones": ["nombres de otras personas relacionadas"]
  }],
  "projects": [{
    "nombre": "string",
    "slug": "slug-corto",
    "tipo": "SaaS|portfolio|hobby|videojuego|negocio|etc",
    "estado": "activo|diferido|completado|pausado|abandonado",
    "prioridad": "alta|media|baja",
    "descripcion": "string",
    "siguiente_accion": "string",
    "stack": ["tecnologías"],
    "horizonte": "2026|post-Galicia|3-5 años|etc",
    "notas": ["decisiones o contexto relevante"]
  }],
  "knowledge": [{
    "categoria": "salud|valores|caracter|finanzas|historia|rutina|objetivos|legal|hobbies|otro",
    "clave": "identificador_snake_case",
    "valor": "descripción principal concisa",
    "detalles": ["puntos adicionales"],
    "importancia": "alta|media|baja"
  }]
}

MEMORIAS DE BORJA (${memories.length} registros):
${memList}`;

  // 3. Llamar al LLM (siempre cloud para garantizar disponibilidad)
  let raw: string;
  try {
    raw = await askClaude(extractPrompt, { useCloud: true, maxTokens: 4096, temperature: 0.1 });
  } catch (err) {
    res.status(500).json({ error: 'Error al llamar al LLM', detail: (err as Error).message });
    return;
  }

  // 4. Extraer JSON de la respuesta (el LLM puede añadir texto antes/después)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    res.status(500).json({ error: 'El LLM no devolvió JSON válido', preview: raw.slice(0, 300) });
    return;
  }

  let extracted: { people?: any[]; projects?: any[]; knowledge?: any[] };
  try {
    extracted = JSON.parse(jsonMatch[0]);
  } catch {
    res.status(500).json({ error: 'JSON inválido en la respuesta del LLM', preview: jsonMatch[0].slice(0, 300) });
    return;
  }

  // 5. Insertar — idempotente (salta si ya existe)
  let peopleCreated = 0, peopleSkipped = 0;
  let projCreated   = 0, projSkipped   = 0;
  let knowCreated   = 0, knowSkipped   = 0;

  for (const p of (extracted.people || [])) {
    if (!p.nombre?.trim()) continue;
    const exists = await Person.findOne({ nombre: new RegExp(`^${p.nombre.trim()}$`, 'i') });
    if (exists) { peopleSkipped++; }
    else        { await Person.create(p); peopleCreated++; }
  }

  for (const p of (extracted.projects || [])) {
    if (!p.nombre?.trim()) continue;
    const key = p.slug?.trim() || p.nombre.trim().toLowerCase().replace(/\s+/g, '-');
    const exists = await Project.findOne({ slug: key });
    if (exists) { projSkipped++; }
    else        { await Project.create({ ...p, slug: key }); projCreated++; }
  }

  for (const k of (extracted.knowledge || [])) {
    if (!k.clave?.trim()) continue;
    const exists = await KnowledgeEntry.findOne({ clave: k.clave.trim() });
    if (exists) { knowSkipped++; }
    else        { await KnowledgeEntry.create(k); knowCreated++; }
  }

  console.log(`🧠 migrate-memories: people +${peopleCreated} | projects +${projCreated} | knowledge +${knowCreated}`);
  res.json({
    ok: true,
    memorias_leidas: memories.length,
    people:    { created: peopleCreated,   skipped: peopleSkipped,   total: extracted.people?.length    ?? 0 },
    projects:  { created: projCreated,     skipped: projSkipped,     total: extracted.projects?.length  ?? 0 },
    knowledge: { created: knowCreated,     skipped: knowSkipped,     total: extracted.knowledge?.length ?? 0 },
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

  const memList = memories
    .map(m => `ID:${String(m._id)} [${(m.tags || []).join(',')}] ${m.content}`)
    .join('\n');

  const prompt = `Eres un experto en gestión del conocimiento personal. Analiza estas ${memories.length} memorias del sistema personal de Borja e identifica duplicados y redundancias.

CRITERIOS:
- DUPLICADO: misma información con diferente redacción → fusionar en una, borrar las demás
- SUBCONJUNTO: una memoria tiene TODA la info de otra + más → eliminar la menor
- TEST/VACÍO: contenido de test, vacío o inútil → eliminar directamente
- COMPLEMENTARIAS: mismo tema pero cada una añade info única → conservar (puedes fusionar si encaja)
- DUDA: conservar ambas

Para cada grupo a fusionar: proporciona el contenido completo con TODA la información única combinada.
Copia los IDs EXACTAMENTE como aparecen (24 caracteres hex).

Responde ÚNICAMENTE con JSON válido, sin texto antes ni después:
{
  "merge_groups": [
    {
      "keep_id": "id_mongo_24_chars",
      "merged_content": "contenido fusionado completo con toda la info única de todas las memorias del grupo",
      "merged_tags": ["tag1","tag2"],
      "delete_ids": ["id1","id2"],
      "razon": "por qué son duplicadas"
    }
  ],
  "delete_standalone": ["id_memoria_test_o_vacia"]
}

Sin duplicados: {"merge_groups":[],"delete_standalone":[]}

MEMORIAS (${memories.length}):
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

  let plan: { merge_groups?: any[]; delete_standalone?: string[] };
  try { plan = JSON.parse(jsonMatch[0]); }
  catch { res.status(500).json({ error: 'JSON inválido en respuesta LLM', preview: jsonMatch[0].slice(0, 400) }); return; }

  const mergeGroups      = plan.merge_groups      || [];
  const deleteStandalone = plan.delete_standalone || [];
  const totalWillDelete  = mergeGroups.reduce((n: number, g: any) => n + (g.delete_ids?.length || 0), 0) + deleteStandalone.length;

  if (dryRun) {
    res.json({
      ok: true, dry_run: true,
      memorias_total: memories.length,
      grupos_a_fusionar: mergeGroups.length,
      a_eliminar_standalone: deleteStandalone.length,
      total_eliminaciones: totalWillDelete,
      memorias_resultado: memories.length - totalWillDelete,
      plan: mergeGroups.map((g: any) => ({
        keep_id: g.keep_id,
        merged_preview: (g.merged_content || '').slice(0, 120) + '…',
        delete_count: g.delete_ids?.length || 0,
        razon: g.razon,
      })),
    });
    return;
  }

  let merged = 0, deleted = 0;

  for (const g of mergeGroups) {
    if (!g.keep_id?.trim()) continue;
    try {
      await Memory.findByIdAndUpdate(g.keep_id, {
        content: g.merged_content || '',
        tags: Array.isArray(g.merged_tags) ? g.merged_tags : [],
      });
      for (const delId of (g.delete_ids || [])) {
        if (!delId?.trim()) continue;
        try { const d = await Memory.findByIdAndDelete(delId); if (d) deleted++; } catch { /* ID inválido */ }
      }
      merged++;
    } catch { /* ID keep inválido */ }
  }

  for (const id of deleteStandalone) {
    if (!id?.trim()) continue;
    try { const d = await Memory.findByIdAndDelete(id); if (d) deleted++; } catch { /* ID inválido */ }
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