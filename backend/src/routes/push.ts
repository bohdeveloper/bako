import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { PushSubscription } from '../memory/PushSubscription';

const router = Router();
router.use(requireAuth);

router.get('/vapid-public-key', (_req: Request, res: Response) => {
  const raw = process.env.VAPID_PUBLIC_KEY ?? '';
  const key = raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  res.json({ key });
});

// GET /api/push/status — diagnóstico para el panel admin
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const count     = await PushSubscription.countDocuments();
    const vapidOk   = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    res.json({ vapidConfigured: vapidOk, subscriptions: count });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/push/test — envía notificación de prueba a todos los suscritos
router.post('/test', async (_req: Request, res: Response) => {
  try {
    const { sendPushToAll } = await import('../services/pushService');
    await sendPushToAll('🔔 Prueba de notificación push de BAKO. ¡Funciona!', 'Prueba de notificación push de BAKO. ¡Funciona!');
    const count = await PushSubscription.countDocuments();
    res.json({ ok: true, sentTo: count });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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

// DELETE /api/push/all — borra todas las suscripciones (para limpiar entradas inválidas)
router.delete('/all', async (_req: Request, res: Response) => {
  try {
    const { deletedCount } = await PushSubscription.deleteMany({});
    res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
