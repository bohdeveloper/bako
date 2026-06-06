import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { Notification } from '../memory/Notification';

const router = Router();
router.use(requireAuth);

// GET /api/notifications/unread?since=ISO_DATE
// Cada cliente (WPA, Desktop) envía su propio timestamp — no hay raza de lecturas
router.get('/unread', async (req: Request, res: Response) => {
  try {
    const sinceRaw = req.query.since as string | undefined;
    const since    = sinceRaw ? new Date(sinceRaw) : new Date(0);
    const items    = await Notification.find({ createdAt: { $gt: since } })
      .sort({ createdAt: 1 })
      .limit(20);
    res.json({ notifications: items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/notifications/mark-read — no-op; TTL elimina las notificaciones en 24h
router.post('/mark-read', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
