import { Router, Request, Response } from 'express';
import { KnowledgeEntry } from '../memory/KnowledgeEntry';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
router.use(requireAuth);

const KNOWLEDGE_FIELDS = [
  'categoria','clave','valor','detalles','importancia','fuente','activo',
] as const;

// GET /api/knowledge — listar todas (opcionalmente filtrar por categoría)
router.get('/', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.categoria) filter['categoria'] = req.query.categoria;
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
  if (!categoria) { res.status(400).json({ error: 'categoria es obligatorio' }); return; }
  if (!clave?.trim()) { res.status(400).json({ error: 'clave es obligatorio' }); return; }
  if (!valor?.trim()) { res.status(400).json({ error: 'valor es obligatorio' }); return; }
  const entry = await KnowledgeEntry.create({
    categoria,
    clave:       clave.trim(),
    valor:       valor.trim(),
    detalles:    req.body.detalles    ?? [],
    importancia: req.body.importancia ?? 'media',
    fuente:      req.body.fuente      ?? 'manual',
  });
  res.status(201).json({ ok: true, entry });
});

// PUT /api/knowledge/:id
router.put('/:id', async (req: Request, res: Response) => {
  const entry = await KnowledgeEntry.findById(req.params.id);
  if (!entry) { res.status(404).json({ error: 'Entrada no encontrada' }); return; }
  for (const f of KNOWLEDGE_FIELDS) {
    if (req.body[f] !== undefined) (entry as any)[f] = req.body[f];
  }
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
