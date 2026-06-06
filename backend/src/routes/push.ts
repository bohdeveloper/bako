import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { PushSubscription } from '../memory/PushSubscription';

const router = Router();
router.use(requireAuth);

router.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY ?? '' });
});

router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return void res.status(400).json({ error: 'Suscripción inválida' });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { endpoint, keys },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete('/subscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) await PushSubscription.deleteOne({ endpoint });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
