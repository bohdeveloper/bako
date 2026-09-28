import { Router, Request, Response } from 'express';
import { Relation } from '../memory/Relation';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
router.use(requireAuth);

// GET /api/relations — B6: el grafo de B4 (dicho y deducido), para que el
// panel pueda enseñar junto a cada Persona/Proyecto/Conocimiento con qué está
// conectado y de dónde salió esa conexión, en vez de vivir solo en el prompt.
router.get('/', async (_req: Request, res: Response) => {
  const relations = await Relation.find({ activo: true }).sort({ updatedAt: -1 }).limit(500);
  res.json({ ok: true, total: relations.length, relations });
});

export default router;
