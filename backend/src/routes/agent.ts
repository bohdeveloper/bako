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

// POST /api/agent/seed-brain — siembra People, Projects y KnowledgeEntry en Atlas (idempotente)
router.post('/seed-brain', async (_req: Request, res: Response) => {
  const { Project } = await import('../memory/Project');
  const { KnowledgeEntry } = await import('../memory/KnowledgeEntry');
  const { Person } = await import('../memory/Person');

  type PersonSeed = { nombre: string; relacion: any; descripcion?: string; cumpleaños?: string; ubicacion?: string; trabajo?: string; notas?: string[]; conexiones?: string[] };
  type PS = { nombre: string; slug?: string; tipo?: string; estado?: any; prioridad?: any; descripcion?: string; siguiente_accion?: string; stack?: string[]; urls?: string[]; horizonte?: string; notas?: string[] };
  type KS = { categoria: any; clave: string; valor: string; importancia: any; detalles?: string[] };

  const PEOPLE: PersonSeed[] = [
    { nombre:'Yaimy', relacion:'pareja', descripcion:'Pareja de Borja — cubana, 36 años. Trabaja en LAE (empresa gallega). Plan: mudarse a Galicia juntos a finales de 2026.', cumpleaños:'02-01', ubicacion:'Errentería', trabajo:'LAE (empresa en Galicia)', notas:['Aniversario con Borja: 9 de junio — 2 años en 2026','Sus padres (Sofi y Osvaldo) viven en Lezo','Yosiel (cuñado colombiano) vive en Lezo'], conexiones:['Sofi','Osvaldo','Yosiel'] },
    { nombre:'Sofi', relacion:'familiar', descripcion:'Madre de Yaimy — cubana. Vive en Lezo con Osvaldo.', ubicacion:'Lezo', conexiones:['Yaimy','Osvaldo'] },
    { nombre:'Osvaldo', relacion:'familiar', descripcion:'Padre de Yaimy — cubano. Vive en Lezo con Sofi.', ubicacion:'Lezo', conexiones:['Yaimy','Sofi'] },
    { nombre:'Yosiel', relacion:'familiar', descripcion:'Cuñado de Borja — colombiano. Hermano de Yaimy. Vive en Lezo.', ubicacion:'Lezo', conexiones:['Yaimy'] },
  ];

  const PROJECTS: PS[] = [
    { nombre:'BAKO', slug:'bako', tipo:'Sistema operativo personal con IA', estado:'activo', prioridad:'alta', descripcion:'Mayordomo digital omnisciente. Evoluciona hacia JARVIS: cuerpo robótico, presencia física, voz, Telegram, GitHub.', siguiente_accion:'Fase 7b-B desplegada — continuar con embeddings Ollama', stack:['Node.js','TypeScript','Express','MongoDB Atlas','Groq','Ollama','Render','Telegram Bot'], urls:['https://ai-personal-os.onrender.com'], horizonte:'3-5 años (robótico)', notas:['MVP en producción en Render','Visión final: Jarvis de Iron Man en la vida real'] },
    { nombre:'bohdeveloper.com', slug:'bohdeveloper', tipo:'Portfolio personal', estado:'activo', prioridad:'media', descripcion:'Portfolio personal con Tracker diario y gestor de blog.', siguiente_accion:'Integración BAKO para marcar actividades por voz', stack:['Next.js','TypeScript','Cloudflare Pages','Cloudflare D1'], urls:['https://bohdeveloper.com'], horizonte:'2026', notas:['Tracker diario en uso diario integrado con BAKO'] },
    { nombre:'Diamadmin', slug:'diamadmin', tipo:'SaaS propio', estado:'activo', prioridad:'alta', descripcion:'SaaS de gestión con roadmap definido.', stack:['Angular','Spring Boot','PostgreSQL'], urls:['https://app.diamadmin.com','https://diamadmin.com'], horizonte:'2026', notas:[] },
    { nombre:'Unyona', slug:'unyona', tipo:'SaaS en validación', estado:'activo', prioridad:'media', descripcion:'Landing para capturar leads antes de construir el producto.', urls:['https://unyona.com'], horizonte:'2026', notas:[] },
    { nombre:'Nitflex', slug:'nitflex', tipo:'App streaming — portfolio', estado:'pausado', prioridad:'baja', descripcion:'Clon de Netflix con TMDB API. Home screen funcionando.', stack:['React','TypeScript','Express','MongoDB','TMDB API'], horizonte:'indefinido', notas:['Proyecto portfolio — no prioritario'] },
    { nombre:'Drones FPV', slug:'drones-fpv', tipo:'Hobby — cinematografía aérea', estado:'diferido', prioridad:'baja', descripcion:'Aprender a pilotar drones FPV y hacer cinematografía 4K en Galicia.', siguiente_accion:'Arrancar tras mudanza: simulador Liftoff → licencia A2 AESA', horizonte:'post-Galicia (finales 2026+)', notas:['~1.000€ primer drone 5"','Ruta: Liftoff → A2 AESA → drone → cinematografía'] },
    { nombre:'Matrix Game', slug:'matrix-game', tipo:'Videojuego open-world', estado:'diferido', prioridad:'baja', descripcion:'GTA V + Cyberpunk + Matrix lore. Mundo 5km², 200+ NPCs, economía funcional, hacking, combate parkour/gun-fu.', stack:['Unreal Engine 5','C++','Blueprints','Blender','FMOD'], horizonte:'4-6 años post-Galicia', notas:['Proyecto personal confidencial','Requiere aprender C++, 3D math y Blender'] },
    { nombre:'Proyecto Kefir Artesanal', slug:'kefir', tipo:'Negocio artesanal + e-commerce', estado:'diferido', prioridad:'baja', descripcion:'Productor y vendedor de kefir artesanal en Galicia. Venta directa con suscripción recurrente.', stack:['Next.js','PostgreSQL','Stripe'], horizonte:'post-Galicia (finales 2026+)', notas:['Objetivo: 1.500-2.500€/mes en 6-12 meses desde lanzamiento','Borja es productor + desarrollador — coste tech cero'] },
  ];

  const KNOWLEDGE: KS[] = [
    { categoria:'historia', clave:'origen', valor:'Borja, 34 años, Errentería, Gipuzkoa, País Vasco. Cumple 35 el 12-07-2026.', importancia:'alta' },
    { categoria:'historia', clave:'situacion_laboral', valor:'Centro de empleabilidad Inetum (Donostia) — sin proyecto asignado. En búsqueda activa de empleo.', detalles:['Todos sus proyectos son personales — ninguno pertenece a Inetum'], importancia:'alta' },
    { categoria:'historia', clave:'perfil_tecnico', valor:'Developer Fullstack orientado a arquitectura de sistemas.', detalles:['Frontend: React, Angular, Next.js, Tailwind, TypeScript','Backend: Express.js, Spring Boot, Node.js','BBDD: MongoDB, PostgreSQL','DevOps: Cloudflare, Docker básico, Git/GitHub','Aprendiendo: Agentes IA, Ollama, ML, Python para IA'], importancia:'alta' },
    { categoria:'historia', clave:'pareja', valor:'Yaimy — cubana, 36 años (cumple 2 de enero). Vive en Errentería con Borja. Trabaja en LAE (empresa gallega, NO empleador de Borja).', detalles:['Aniversario: 9 de junio — 2 años en 2026','Plan: mudarse juntos a Galicia a finales de 2026','Padres cubanos Sofi y Osvaldo en Lezo. Yosiel (cuñado colombiano) en Lezo'], importancia:'alta' },
    { categoria:'historia', clave:'mudanza_galicia', valor:'Buscando vivienda en Galicia — dentro de ~30km de Pontevedra Y Vigo simultáneamente.', detalles:['Requisitos: pet-friendly, espacio exterior, fibra óptica','Zonas top: Caldas de Reis, Cerdedo-Cotobade, Cuntis, A Estrada, Ponte Caldelas','Horizonte: finales 2026'], importancia:'alta' },
    { categoria:'valores', clave:'filosofia_base', valor:'Estoicismo — Marcus Aurelius, Jonas Salzgeber. Disciplina diaria, control de lo que depende de uno.', importancia:'alta' },
    { categoria:'valores', clave:'fortalezas', valor:'Mentalidad arquitecto — diseña sistemas complejos con visión global. Fullstack moderno. Visión producto: piensa en el negocio, no solo en el código.', importancia:'media' },
    { categoria:'rutina', clave:'rutina_diaria', valor:'Despertar 05:00 (desde 8-jun-2026). Kronoshin 05:20-06:00. Bus a Donostia 06:30. Trabajo 07:00-14:00. Casa 15:00.', detalles:['Lun/Vie 19:30-20:45 BIZIKI running','Mié 19:30-20:45 running','Mar/Jue 15:30-17:30 gym/Shaolin','Jue 18:00-19:00 psicólogo Donostia','Mar/Jue 21:00-22:00 lectura estoica','Sáb mañana: monte','Dom mañana: gym/Shaolin'], importancia:'alta' },
    { categoria:'rutina', clave:'kronoshin', valor:'Actividad diaria 05:20-06:00 L-V: ejercicios Shaolin + flexibilidad corporal. Se registra en el Tracker. NO es un proyecto de software.', importancia:'alta' },
    { categoria:'rutina', clave:'entrenamiento', valor:'Shaolin autodidacta en Fuerte de Arramendi. Running con grupo BIZIKI (Donostia-Errentería).', importancia:'media' },
    { categoria:'salud', clave:'psicologo', valor:'Asiste a psicólogo todos los jueves 18:00-19:00 en Donostia.', importancia:'media' },
    { categoria:'objetivos', clave:'vision_vida', valor:'Construir BAKO como mayordomo omnisciente + mudarse a Galicia con Yaimy + proyectos propios con ingresos pasivos.', importancia:'alta' },
    { categoria:'objetivos', clave:'busqueda_empleo', valor:'Búsqueda activa de nuevo empleo como developer fullstack. Actualmente en Inetum sin proyecto asignado.', importancia:'alta' },
    { categoria:'hobbies', clave:'intereses_principales', valor:'Shaolin, running, naturaleza, estoicismo, videojuegos, cinematografía, IA, robótica.', importancia:'baja' },
    { categoria:'otro', clave:'infraestructura_bako', valor:'Backend en Render (24/7). Ollama local vía Cloudflare Tunnel cuando PC encendido. Fallback automático a Groq.', detalles:['Modelo local: Ollama qwen2.5-coder:7b — sin límites, privado, gratuito','Modelo nube: Groq llama-3.1-8b-instant — fallback automático','Túnel: Cloudflare Tunnel bako-ollama vía Task Scheduler','Groq límites: 20k tokens/min, 14.4k peticiones/día (reset 01:00 hora España)'], importancia:'media' },
  ];

  let peopleCreated = 0, peopleSkipped = 0;
  let projCreated = 0, projSkipped = 0;
  let knowCreated = 0, knowSkipped = 0;

  for (const p of PEOPLE) {
    const exists = await Person.findOne({ nombre: p.nombre });
    if (exists) { peopleSkipped++; } else { await Person.create(p); peopleCreated++; }
  }

  for (const p of PROJECTS) {
    const exists = await Project.findOne({ slug: p.slug });
    if (exists) { projSkipped++; } else { await Project.create(p); projCreated++; }
  }

  for (const k of KNOWLEDGE) {
    const exists = await KnowledgeEntry.findOne({ clave: k.clave });
    if (exists) { knowSkipped++; } else { await KnowledgeEntry.create(k); knowCreated++; }
  }

  res.json({ ok: true, people: { created: peopleCreated, skipped: peopleSkipped }, projects: { created: projCreated, skipped: projSkipped }, knowledge: { created: knowCreated, skipped: knowSkipped } });
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