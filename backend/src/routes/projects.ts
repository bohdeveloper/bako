import { Router, Request, Response } from 'express';
import { Project } from '../memory/Project';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
router.use(requireAuth);

const PROJECT_FIELDS = [
  'nombre','slug','tipo','estado','prioridad','descripcion',
  'siguiente_accion','bloqueantes','decisiones','stack','urls',
  'horizonte','notas','activo',
] as const;

// GET /api/projects
router.get('/', async (_req: Request, res: Response) => {
  const projects = await Project.find().sort({ orden: 1, nombre: 1 });
  res.json({ ok: true, total: projects.length, projects });
});

// PATCH /api/projects/reorder — { ids: string[] } — reordena por posición en el array
router.patch('/reorder', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids debe ser un array' });
    return;
  }
  await Promise.all(ids.map((id: string, i: number) =>
    Project.findByIdAndUpdate(id, { orden: i })
  ));
  res.json({ ok: true, reordered: ids.length });
});

// GET /api/projects/:id
router.get('/:id', async (req: Request, res: Response) => {
  const project = await Project.findById(req.params.id);
  if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
  res.json({ ok: true, project });
});

// POST /api/projects
router.post('/', async (req: Request, res: Response) => {
  const { nombre } = req.body;
  if (!nombre?.trim()) { res.status(400).json({ error: 'El nombre es obligatorio' }); return; }
  const project = await Project.create({
    nombre: nombre.trim(),
    slug:             req.body.slug             ?? '',
    tipo:             req.body.tipo             ?? '',
    estado:           req.body.estado           ?? 'activo',
    prioridad:        req.body.prioridad        ?? 'media',
    descripcion:      req.body.descripcion      ?? '',
    siguiente_accion: req.body.siguiente_accion ?? '',
    bloqueantes:      req.body.bloqueantes      ?? [],
    decisiones:       req.body.decisiones       ?? [],
    stack:            req.body.stack            ?? [],
    urls:             req.body.urls             ?? [],
    horizonte:        req.body.horizonte        ?? '',
    notas:            req.body.notas            ?? [],
  });
  res.status(201).json({ ok: true, project });
});

// PUT /api/projects/:id
router.put('/:id', async (req: Request, res: Response) => {
  const project = await Project.findById(req.params.id);
  if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
  for (const f of PROJECT_FIELDS) {
    if (req.body[f] !== undefined) (project as any)[f] = req.body[f];
  }
  await project.save();
  res.json({ ok: true, project });
});

// DELETE /api/projects/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const project = await Project.findByIdAndDelete(req.params.id);
  if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
  res.json({ ok: true, deleted: req.params.id });
});

export default router;
