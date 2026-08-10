import { Router, Request, Response } from 'express';
import { askClaude, isOllamaAvailable, PrivacyError } from '../llm/claude';
import { Task } from '../memory/Task';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { BAKO_PROFILE } from '../knowledge/profile';
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
    res.json({ ok: true, message: 'No hay memorias', people: 0, knowledge: 0 });
    return;
  }

  // Valores válidos de enum por colección
  const RELACIONES   = ['pareja','familiar','amigo','compañero','conocido','otro'];
  const CATEGORIAS   = ['salud','valores','caracter','finanzas','historia','rutina','objetivos','legal','hobbies','otro'];
  const IMPORTANCIAS = ['alta','media','baja'];

  const fixEnum = (v: any, valid: string[], fb: string) => {
    const s = String(v || '').trim().toLowerCase();
    return valid.includes(s) ? s : fb;
  };

  // Sin proyectos: la fuente de verdad de los proyectos es Notion, no las memorias.
  const SCHEMA = `{"people":[{"nombre":"","relacion":"pareja|familiar|amigo|compañero|conocido|otro","descripcion":"","cumpleaños":"DD-MM","ubicacion":"","trabajo":"","notas":[],"conexiones":[]}],"knowledge":[{"categoria":"salud|valores|caracter|finanzas|historia|rutina|objetivos|legal|hobbies|otro","clave":"snake_case","valor":"","detalles":[],"importancia":"alta|media|baja"}]}`;

  const BATCH = 50;
  const col = { people: [] as any[], knowledge: [] as any[] };
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
    merge(col.knowledge, ext.knowledge, (x: any) => x.clave);
    batchesOk++;
  }

  // Complementar con personas conocidas de profile.ts — fuente autoritativa (sin LLM)
  const MESES: Record<string, string> = {
    enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06',
    julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12',
  };
  const parseCumple = (s: string) => {
    const m = String(s || '').match(/(\d+)\s+de\s+(\w+)/i);
    if (!m) return '';
    const mes = MESES[m[2].toLowerCase()];
    return mes ? `${m[1].padStart(2, '0')}-${mes}` : '';
  };

  const profilePeople: any[] = [
    { nombre: 'Yaimy',       relacion: 'pareja',   cumpleaños: parseCumple(BAKO_PROFILE.pareja.cumpleanos), ubicacion: 'Errentería', trabajo: 'LAE (Galicia)' },
    { nombre: 'Sofi',        relacion: 'familiar', descripcion: 'Madre de Yaimy (suegra), cubana',       cumpleaños: parseCumple('18 de septiembre'), ubicacion: 'Lezo' },
    { nombre: 'Osvaldo',     relacion: 'familiar', descripcion: 'Padre de Yaimy (suegro), cubano',       cumpleaños: parseCumple('28 de febrero'),    ubicacion: 'Lezo' },
    { nombre: 'Yosiel',      relacion: 'familiar', descripcion: 'Hermano de Yaimy (cuñado), colombiano', cumpleaños: parseCumple('24 de septiembre'), ubicacion: 'Lezo' },
    { nombre: (BAKO_PROFILE.familia_directa as any).padre.nombre,  relacion: 'familiar', descripcion: 'Padre',   cumpleaños: parseCumple((BAKO_PROFILE.familia_directa as any).padre.cumpleanos),  ubicacion: 'Errentería' },
    { nombre: (BAKO_PROFILE.familia_directa as any).madre.nombre,  relacion: 'familiar', descripcion: 'Madre',   cumpleaños: parseCumple((BAKO_PROFILE.familia_directa as any).madre.cumpleanos),  ubicacion: 'Errentería' },
    { nombre: (BAKO_PROFILE.familia_directa as any).hermana.nombre, relacion: 'familiar', descripcion: 'Hermana', cumpleaños: parseCumple((BAKO_PROFILE.familia_directa as any).hermana.cumpleanos) },
    { nombre: (BAKO_PROFILE.familia_directa as any).cunada.nombre,  relacion: 'familiar', descripcion: 'Cuñada (mujer de su hermana)', cumpleaños: parseCumple((BAKO_PROFILE.familia_directa as any).cunada.cumpleanos) },
    ...(BAKO_PROFILE.amigos as any).lista.map((a: any) => ({
      nombre:     a.nombre,
      relacion:   'amigo',
      descripcion: a.descripcion || (a.origen ? `De origen ${a.origen}` : ''),
      cumpleaños:  parseCumple(a.cumpleanos || ''),
      ubicacion:   a.vive || '',
      notas:       a.pareja ? [`Pareja: ${a.pareja}`] : [],
    })),
  ];

  // Fusionar profile > LLM: profile.ts es autoritativo para personas conocidas
  for (const pp of profilePeople) {
    const k = (pp.nombre || '').trim().toLowerCase();
    if (!k) continue;
    const idx = col.people.findIndex((x: any) => (x.nombre || '').trim().toLowerCase() === k);
    if (idx === -1) col.people.push(pp);
    else Object.assign(col.people[idx], pp); // profile sobrescribe al LLM
  }

  // Complementar con conocimiento de profile.ts — fuente autoritativa (sin LLM)
  const profileKnowledge: any[] = [
    // ── Salud ────────────────────────────────────────────────────────────────
    { categoria: 'salud', clave: 'habitos_salud', importancia: 'alta',
      valor: 'Exfumador muy orgulloso de haberlo dejado. Rara vez bebe alcohol (como mucho una cerveza ocasional). Energía alta por naturaleza, varía según dieta.',
    },
    { categoria: 'salud', clave: 'suplementacion', importancia: 'media',
      valor: 'Toma suplementos diariamente: vitaminas, té verde, magnesio, creatina y ashwagandha.',
    },
    { categoria: 'salud', clave: 'digestion', importancia: 'media',
      valor: 'A veces hace mal la digestión y tiene ardores. Toma kéfir diariamente para mejorar la digestión.',
    },
    { categoria: 'salud', clave: 'sueno', importancia: 'media',
      valor: 'Duerme entre 6 y 8 horas. Generalmente duerme bien. Objetivo activo: acostarse antes para madrugar más.',
    },
    { categoria: 'salud', clave: 'psicologo', importancia: 'alta',
      valor: 'Asiste a psicólogo todos los jueves de 18:00 a 19:00 en Donostia. Parte fija de su rutina semanal.',
    },
    // ── Valores ──────────────────────────────────────────────────────────────
    { categoria: 'valores', clave: 'filosofia_base', importancia: 'alta',
      valor: 'Estoicismo como filosofía de vida: Marcus Aurelius, Jonas Salzgeber. Disciplina diaria y control de lo que depende de uno.',
    },
    { categoria: 'valores', clave: 'valores_core', importancia: 'alta',
      valor: 'La libertad es su valor más importante — le preocupa profundamente la falta de ella. Quiere ser buena persona, estar en paz y tener una vida con propósito.',
    },
    // ── Carácter ─────────────────────────────────────────────────────────────
    { categoria: 'caracter', clave: 'caracter_descripcion', importancia: 'alta',
      valor: 'Se describe como impulsivo, caliente, enérgico, empático y leal. Perfeccionista, emprendedor y comprometido con sus metas.',
      detalles: ['Mayor virtud: autosuperación constante', 'Mayor defecto: poco autocontrol', 'Valora en otros: que aporten, empatía, tranquilidad y buena energía'],
    },
    // ── Finanzas ─────────────────────────────────────────────────────────────
    { categoria: 'finanzas', clave: 'situacion_financiera', importancia: 'alta',
      valor: 'Sin deudas. Gasto fijo principal: alquiler 790€/mes en Errentería. Objetivo: ahorrar 5.000-10.000€ entre Borja y Yaimy.',
      detalles: ['La mudanza a Galicia reducirá el gasto fijo en 200-300€/mes', 'No invierte aún — quiere aprender a invertir bien en el futuro'],
    },
    { categoria: 'finanzas', clave: 'estrategia_ingresos_pasivos', importancia: 'media',
      valor: 'Objetivo gradual: complementar el sueldo con ingresos pasivos → igualar el sueldo → si se puede, superarlo.',
      detalles: ['Criterios: bajo mantenimiento, modelo recurrente, escalable, alineado con su stack', 'Plataformas: Gumroad, Lemon Squeezy, Stripe, Udemy, GitHub Sponsors'],
    },
    // ── Historia ─────────────────────────────────────────────────────────────
    { categoria: 'historia', clave: 'logros_personales', importancia: 'alta',
      valor: 'Aprendió a programar desde cero por sus propios medios y consiguió vivir de ello. Dejó de fumar. Mantiene disciplina de entrenamiento diario.',
    },
    { categoria: 'historia', clave: 'momento_dificil', importancia: 'alta',
      valor: 'Hace ~9 meses (septiembre 2025) atravesó el momento más difícil de su vida. Lo superó y es una persona nueva desde entonces. BAKO NO debe sacar este tema salvo que Borja lo mencione explícitamente.',
    },
    // ── Rutina ───────────────────────────────────────────────────────────────
    { categoria: 'rutina', clave: 'rutina_diaria', importancia: 'alta',
      valor: 'Se despierta a las 05:00. Kronoshin (Shaolin + flexibilidad) 05:20-06:00. Ducha fría, desayuno, preparación 06:00-06:30. Bus Errentería→Donostia 06:30. Inetum 07:00-14:00. Llega a casa a las 15:00.',
      detalles: ['Lun y Vie 19:30-20:45: BIZIKI running', 'Mié 19:30-20:45: running', 'Mar y Jue 15:30-17:30: gym / Shaolin', 'Jue 18:00-19:00: psicólogo', 'Mar y Jue 21:00-22:00: lectura estoica', 'Sáb mañana: monte', 'Dom mañana: gym/Shaolin'],
    },
    { categoria: 'rutina', clave: 'entrenamiento', importancia: 'alta',
      valor: 'Shaolin autodidacta en el Fuerte de Arramendi (Errentería). Kronoshin cada mañana L-V 05:20-06:00. Running con grupo BIZIKI (Donostia-Errentería). Gym martes y jueves.',
    },
    // ── Objetivos ────────────────────────────────────────────────────────────
    { categoria: 'objetivos', clave: 'sueno_galicia', importancia: 'alta',
      valor: 'Mudarse a Galicia con Yaimy a finales de 2026. Casa propia con terreno grande: espacio para laboratorio BAKO/JARVIS, zona para el kéfir artesanal, gimnasio exterior, taller para robótica e impresión 3D, terreno para cultivar y casa auxiliar para suegros.',
    },
    { categoria: 'objetivos', clave: 'busqueda_vivienda_galicia', importancia: 'alta',
      valor: 'Operación Galego: relocalización a Galicia en 6-12 meses. Buscan casa individual con terreno en el eje Vigo-Pontevedra, <600€/mes (máx 800€). Pet-friendly imprescindible. Yaimy anclada a Vigo (única sede LAE). Inetum en Pontevedra. Fase actual: exploración, no comunicado en empresa.',
      detalles: [
        'Zonas top: Vilaboa (15min Vigo, 10min Pontevedra), Soutomaior (bosque interior), Barro/Portas, Cotobade, Moaña/Cangas',
        'Viaje presencial semana del 6 de julio 2026 — Vilaboa, Soutomaior, Barro',
        'Agencias contactadas: Inmobiliaria Molinos (Redondela), Arines, Segurdela, Javier Tovar (jtovar.com), Inmogalaica',
        'Tipo: casa individual + alpendre acondicionable para suegros, 2hab+2baños, lista para entrar',
        'Ahorro proyectado post-traslado: 200-300€/mes respecto a los 790€ actuales en Errentería',
      ],
    },
    { categoria: 'objetivos', clave: 'independencia_profesional', importancia: 'alta',
      valor: 'Vivir y trabajar en remoto desde Galicia. Si los proyectos e inversiones permiten vivir bien, dejaría de trabajar para otros. Familia: quieren tener hijos a medio-largo plazo y un perro grande.',
    },
    // ── Legal ────────────────────────────────────────────────────────────────
    { categoria: 'legal', clave: 'proceso_judicial', importancia: 'alta',
      valor: 'Involucrado como acusado en un proceso judicial. Fecha clave: 30 de junio de 2026 (declaración con su abogado). INFORMACIÓN SENSIBLE Y CONFIDENCIAL — BAKO no debe mencionar este tema a menos que Borja lo plantee directamente.',
    },
    // ── Hobbies ──────────────────────────────────────────────────────────────
    { categoria: 'hobbies', clave: 'gustos_ocio', importancia: 'media',
      valor: 'Videojuegos, tiempo con Yaimy, paseos en la naturaleza, meditación, cocinar y viajar.',
      detalles: ['Comidas favoritas: alitas, pizza, endivias con aceitunas y atún, carnes, sushi, hamburguesas, pasta, comida cubana. Evita marisco.', 'Películas: Interstellar, Gladiator, Avatar, El Señor de los Anillos, Inception, Breaking Bad', 'Series: Vikings, Mr Robot. Anime: Naruto, One Piece', 'Música trabajando: tranquila/slowed. Entrenando: trap/rap energético'],
    },
  ];

  // Fusionar profile > LLM para conocimiento
  for (const pk of profileKnowledge) {
    const k = (pk.clave || '').trim().toLowerCase();
    if (!k) continue;
    const idx = col.knowledge.findIndex((x: any) => (x.clave || '').trim().toLowerCase() === k);
    if (idx === -1) col.knowledge.push(pk);
    else Object.assign(col.knowledge[idx], pk);
  }

  // Insertar en Atlas — idempotente + sanitización de enums + try/catch individual
  let pC = 0, pS = 0, pE = 0;
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

  for (const k of col.knowledge) {
    if (!k.clave?.trim()) continue;
    try {
      const safe = { ...k, clave: k.clave.trim(), fuente: 'extracted', categoria: fixEnum(k.categoria, CATEGORIAS, 'otro'), importancia: fixEnum(k.importancia, IMPORTANCIAS, 'media') };
      const ok   = await KnowledgeEntry.findOne({ clave: safe.clave });
      if (ok) { kS++; } else { await KnowledgeEntry.create(safe); kC++; }
    } catch (e) { console.error(`Knowledge.create(${k.clave}):`, (e as Error).message); kE++; }
  }

  console.log(`🧠 migrate-memories: ${batchesOk}/${Math.ceil(memories.length / BATCH)} lotes ok · p+${pC}(e${pE}) k+${kC}(e${kE})`);
  res.json({
    ok: true,
    memorias_leidas: memories.length,
    lotes: `${batchesOk}/${Math.ceil(memories.length / BATCH)}`,
    people:    { created: pC, skipped: pS, errors: pE, total: col.people.length },
    knowledge: { created: kC, skipped: kS, errors: kE, total: col.knowledge.length },
  });
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

// POST /api/agent/embed-memories — genera embeddings para memorias que aún no los tienen
// Usa Ollama si está disponible, Cloudflare Workers AI como fallback
router.post('/embed-memories', async (_req: Request, res: Response) => {
  const { Memory } = await import('../memory/Memory');
  const { generateEmbedding } = await import('../tools/embeddings');

  const pending = await Memory.find({ embeddingDim: 0 });
  if (!pending.length) {
    res.json({ ok: true, message: 'Todas las memorias ya tienen embedding', embedded: 0 });
    return;
  }

  let ok = 0, err = 0;
  for (const m of pending) {
    try {
      const { vector, dim, model } = await generateEmbedding(m.content);
      await Memory.findByIdAndUpdate(m._id, { embedding: vector, embeddingDim: dim, embeddingModel: model });
      ok++;
    } catch { err++; }
    // Pequeña pausa para no saturar Cloudflare si hay muchas memorias
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`🔢 embed-memories: ${ok} embeddings generados (${err} errores) de ${pending.length} pendientes`);
  res.json({ ok: true, embedded: ok, errors: err, total: pending.length });
});

// POST /api/agent/clean-manual-memories — elimina todas las memorias source=manual (ya cubiertas por People/Projects/Knowledge)
router.post('/clean-manual-memories', async (_req: Request, res: Response) => {
  const { Memory } = await import('../memory/Memory');
  try {
    const antes = await Memory.countDocuments();
    const result = await Memory.deleteMany({ source: 'manual' });
    const despues = await Memory.countDocuments();
    console.log(`🗑️ clean-manual-memories: ${result.deletedCount} memorias manuales eliminadas. ${antes} → ${despues}`);
    res.json({ ok: true, deleted: result.deletedCount, memorias_antes: antes, memorias_despues: despues });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando memorias manuales', detail: (err as Error).message });
  }
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