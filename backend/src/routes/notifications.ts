import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { Notification } from '../memory/Notification';

const router = Router();
router.use(requireAuth);

// GET /api/notifications/unread — devuelve notificaciones no leídas
router.get('/unread', async (_req: Request, res: Response) => {
  try {
    const items = await Notification.find({ read: false })
      .sort({ createdAt: 1 })
      .limit(20);
    res.json({ notifications: items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/notifications/mark-read — marca como leídas
router.post('/mark-read', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (Array.isArray(ids) && ids.length > 0) {
      await Notification.updateMany({ _id: { $in: ids } }, { read: true });
    } else {
      await Notification.updateMany({ read: false }, { read: true });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
