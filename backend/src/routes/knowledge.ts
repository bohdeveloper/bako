import { Router, Request, Response } from 'express';
import { KnowledgeEntry } from '../memory/KnowledgeEntry';
import { requireAuth } from '../middleware/authMiddleware';
import { sanitizeString, sanitizeTags } from '../middleware/security';

const router = Router();
router.use(requireAuth);

const VALID_CATS = ['salud','valores','caracter','finanzas','historia','rutina','objetivos','legal','hobbies','otro'] as const;
const VALID_IMP  = ['alta','media','baja'] as const;

// GET /api/knowledge — listar todas (opcionalmente filtrar por categoría)
router.get('/', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  // Solo acepta categorías del enum — evita inyección de operadores MongoDB ($where, etc.)
  const cat = req.query.categoria as string | undefined;
  if (cat && (VALID_CATS as readonly string[]).includes(cat)) filter['categoria'] = cat;
  if (req.query.activo !== undefined) filter['activo'] = req.query.activo !== 'false';
  const entries = await KnowledgeEntry.find(filter).sort({ categoria: 1, importancia: 1, clave: 1 });
  res.json({ ok: true, total: entries.length, entries });
});

// GET /api/knowledge/:id
router.get('/:id', async (req: Request, res: Response) => {
  const entry = await KnowledgeEntry.findById(req.params.id);
  if (!entry) { res.status(404).json({ error: 'Entrada no encontrada' }); return; }
  res.json({ ok: true, entry });
});

// POST /api/knowledge
router.post('/', async (req: Request, res: Response) => {
  const { categoria, clave, valor } = req.body;
  if (!categoria || !(VALID_CATS as readonly string[]).includes(categoria)) {
    res.status(400).json({ error: `categoria debe ser uno de: ${VALID_CATS.join(', ')}` }); return;
  }
  if (!clave?.trim()) { res.status(400).json({ error: 'clave es obligatorio' }); return; }
  if (!valor?.trim()) { res.status(400).json({ error: 'valor es obligatorio' }); return; }
  const rawImp = req.body.importancia ?? 'media';
  const entry = await KnowledgeEntry.create({
    categoria,
    clave:       sanitizeString(clave, 100),
    valor:       sanitizeString(valor, 1000),
    detalles:    sanitizeTags(req.body.detalles),
    importancia: (VALID_IMP as readonly string[]).includes(rawImp) ? rawImp : 'media',
    fuente:      req.body.fuente === 'manual' ? 'manual' : 'extracted',
  });
  res.status(201).json({ ok: true, entry });
});

// PUT /api/knowledge/:id
router.put('/:id', async (req: Request, res: Response) => {
  const entry = await KnowledgeEntry.findById(req.params.id);
  if (!entry) { res.status(404).json({ error: 'Entrada no encontrada' }); return; }
  const b = req.body;
  if (b.categoria  !== undefined && (VALID_CATS as readonly string[]).includes(b.categoria)) entry.categoria  = b.categoria;
  if (b.clave      !== undefined) entry.clave      = sanitizeString(b.clave, 100);
  if (b.valor      !== undefined) entry.valor      = sanitizeString(b.valor, 1000);
  if (b.detalles   !== undefined) entry.detalles   = sanitizeTags(b.detalles);
  if (b.importancia !== undefined && (VALID_IMP as readonly string[]).includes(b.importancia)) entry.importancia = b.importancia;
  if (b.activo     !== undefined) (entry as any).activo = Boolean(b.activo);
  await entry.save();
  res.json({ ok: true, entry });
});

// DELETE /api/knowledge/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const entry = await KnowledgeEntry.findByIdAndDelete(req.params.id);
  if (!entry) { res.status(404).json({ error: 'Entrada no encontrada' }); return; }
  res.json({ ok: true, deleted: req.params.id });
});

export default router;
