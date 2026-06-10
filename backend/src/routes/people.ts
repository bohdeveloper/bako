import { Router, Request, Response } from 'express';
import { Person } from '../memory/Person';
import { requireAuth } from '../middleware/authMiddleware';
import { sanitizeString, sanitizeTags } from '../middleware/security';

const router = Router();
router.use(requireAuth);

// GET /api/people — listar todas las personas
router.get('/', async (_req: Request, res: Response) => {
  const people = await Person.find().sort({ orden: 1, nombre: 1 });
  res.json({ ok: true, total: people.length, people });
});

// PATCH /api/people/reorder — { ids: string[] } — reordena por posición en el array
router.patch('/reorder', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids debe ser un array' });
    return;
  }
  await Promise.all(ids.map((id: string, i: number) =>
    Person.findByIdAndUpdate(id, { orden: i })
  ));
  res.json({ ok: true, reordered: ids.length });
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
  const VALID_REL = ['pareja','familiar','amigo','compañero','conocido','otro'];
  const person = await Person.create({
    nombre:      sanitizeString(nombre, 100),
    alias:       sanitizeTags(alias),
    relacion:    VALID_REL.includes(relacion) ? relacion : 'conocido',
    descripcion: sanitizeString(descripcion ?? '', 500),
    cumpleaños:  sanitizeString(cumpleaños ?? '', 10),
    ubicacion:   sanitizeString(ubicacion ?? '', 100),
    trabajo:     sanitizeString(trabajo ?? '', 200),
    notas:       sanitizeTags(notas),
    conexiones:  sanitizeTags(conexiones),
  });
  res.status(201).json({ ok: true, person });
});

// PUT /api/people/:id — editar persona
router.put('/:id', async (req: Request, res: Response) => {
  const person = await Person.findById(req.params.id);
  if (!person) { res.status(404).json({ error: 'Persona no encontrada' }); return; }
  const VALID_REL = ['pareja','familiar','amigo','compañero','conocido','otro'];
  const b = req.body;
  if (b.nombre      !== undefined) person.nombre      = sanitizeString(b.nombre, 100);
  if (b.alias       !== undefined) (person as any).alias = sanitizeTags(b.alias);
  if (b.relacion    !== undefined) (person as any).relacion = VALID_REL.includes(b.relacion) ? b.relacion : 'conocido';
  if (b.descripcion !== undefined) person.descripcion = sanitizeString(b.descripcion, 500);
  if (b.cumpleaños  !== undefined) (person as any)['cumpleaños'] = sanitizeString(b.cumpleaños, 10);
  if (b.ubicacion   !== undefined) person.ubicacion   = sanitizeString(b.ubicacion, 100);
  if (b.trabajo     !== undefined) person.trabajo     = sanitizeString(b.trabajo, 200);
  if (b.notas       !== undefined) person.notas       = sanitizeTags(b.notas);
  if (b.conexiones  !== undefined) (person as any).conexiones = sanitizeTags(b.conexiones);
  if (b.activo      !== undefined) (person as any).activo = Boolean(b.activo);
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
