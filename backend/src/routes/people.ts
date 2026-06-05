import { Router, Request, Response } from 'express';
import { Person } from '../memory/Person';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
router.use(requireAuth);

// GET /api/people — listar todas las personas
router.get('/', async (_req: Request, res: Response) => {
  const people = await Person.find().sort({ relacion: 1, nombre: 1 });
  res.json({ ok: true, total: people.length, people });
});

// GET /api/people/:id
router.get('/:id', async (req: Request, res: Response) => {
  const person = await Person.findById(req.params.id);
  if (!person) { res.status(404).json({ error: 'Persona no encontrada' }); return; }
  res.json({ ok: true, person });
});

// POST /api/people — crear persona
router.post('/', async (req: Request, res: Response) => {
  const { nombre, alias, relacion, descripcion, cumpleaños, ubicacion, trabajo, notas, conexiones } = req.body;
  if (!nombre?.trim()) { res.status(400).json({ error: 'El nombre es obligatorio' }); return; }
  const person = await Person.create({
    nombre: nombre.trim(), alias: alias ?? [], relacion: relacion ?? 'conocido',
    descripcion: descripcion ?? '', cumpleaños: cumpleaños ?? '',
    ubicacion: ubicacion ?? '', trabajo: trabajo ?? '',
    notas: notas ?? [], conexiones: conexiones ?? [],
  });
  res.status(201).json({ ok: true, person });
});

// PUT /api/people/:id — editar persona
router.put('/:id', async (req: Request, res: Response) => {
  const person = await Person.findById(req.params.id);
  if (!person) { res.status(404).json({ error: 'Persona no encontrada' }); return; }
  const fields = ['nombre','alias','relacion','descripcion','cumpleaños','ubicacion','trabajo','notas','conexiones','activo'] as const;
  for (const f of fields) {
    if (req.body[f] !== undefined) (person as any)[f] = req.body[f];
  }
  await person.save();
  res.json({ ok: true, person });
});

// DELETE /api/people/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const person = await Person.findByIdAndDelete(req.params.id);
  if (!person) { res.status(404).json({ error: 'Persona no encontrada' }); return; }
  res.json({ ok: true, deleted: req.params.id });
});

export default router;
