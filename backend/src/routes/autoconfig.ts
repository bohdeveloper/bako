import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { AutoConfig, JOB_DEFS, setJobEnabled } from '../memory/AutoConfig';
import { rescheduleJob, DEFAULT_SCHEDULES } from '../services/ProactivityService';

const router = Router();
router.use(requireAuth);

// GET /api/autoconfig/jobs — lista todos los jobs con estado habilitado y cron actual
router.get('/jobs', async (_req: Request, res: Response) => {
  try {
    const jobKeys      = JOB_DEFS.map(j => j.key);
    const scheduleKeys = JOB_DEFS.map(j => `schedule_${j.key}`);

    const [configs, schedules] = await Promise.all([
      AutoConfig.find().where('key').in(jobKeys),
      AutoConfig.find().where('key').in(scheduleKeys),
    ]);

    const configMap: Record<string, boolean> = {};
    configs.forEach(c => { configMap[c.key] = c.enabled; });

    const scheduleMap: Record<string, string> = {};
    schedules.forEach(s => {
      if (s.value) scheduleMap[s.key.replace('schedule_', '')] = s.value;
    });

    const jobs = JOB_DEFS.map(j => ({
      ...j,
      enabled: configMap[j.key] !== undefined ? configMap[j.key] : true,
      cron:    scheduleMap[j.key] ?? DEFAULT_SCHEDULES[j.key],
    }));
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/autoconfig/jobs/:key — activa/desactiva un job
router.patch('/jobs/:key', async (req: Request, res: Response) => {
  const key = req.params.key as string;
  const { enabled } = req.body;
  if (!JOB_DEFS.find(j => j.key === key)) {
    res.status(404).json({ error: 'Job no encontrado' }); return;
  }
  try {
    await setJobEnabled(key, !!enabled);
    res.json({ ok: true, key, enabled: !!enabled });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/autoconfig/jobs/:key/schedule — guarda y aplica nuevo horario
router.patch('/jobs/:key/schedule', async (req: Request, res: Response) => {
  const key          = req.params.key as string;
  const { cron: cronExpr } = req.body as { cron: string };

  if (!JOB_DEFS.find(j => j.key === key)) {
    res.status(404).json({ error: 'Job no encontrado' }); return;
  }
  if (!cronExpr || typeof cronExpr !== 'string') {
    res.status(400).json({ error: 'Falta el campo cron' }); return;
  }

  try {
    await AutoConfig.findOneAndUpdate(
      { key: `schedule_${key}` },
      { enabled: true, value: cronExpr },
      { upsert: true }
    );
    try {
      await rescheduleJob(key, cronExpr);
    } catch (liveErr) {
      console.warn(`⚠️  Live reschedule ${key}:`, (liveErr as Error).message);
    }
    res.json({ ok: true, key, cron: cronExpr });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/autoconfig/news-feeds — obtiene los feeds configurados
router.get('/news-feeds', async (_req: Request, res: Response) => {
  try {
    const cfg = await AutoConfig.findOne({ key: 'news_feeds' });
    let feeds: Array<{ key?: string; url?: string; name?: string }> = [];
    if (cfg?.value) {
      try { feeds = JSON.parse(cfg.value); } catch { feeds = []; }
    }
    res.json({ feeds });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/autoconfig/news-feeds — guarda los feeds configurados
router.put('/news-feeds', async (req: Request, res: Response) => {
  const { feeds } = req.body;
  if (!Array.isArray(feeds)) {
    res.status(400).json({ error: 'feeds debe ser un array' }); return;
  }
  try {
    await AutoConfig.findOneAndUpdate(
      { key: 'news_feeds' },
      { enabled: true, value: JSON.stringify(feeds) },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
