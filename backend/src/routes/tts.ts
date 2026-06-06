import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { generateVoiceBuffer, cleanForVoice } from '../tools/tts';

const router = Router();
router.use(requireAuth);

// POST /api/tts — convierte texto a audio WebM/Opus en base64
router.post('/', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Campo text requerido' }); return;
    }
    const clean  = cleanForVoice(text.slice(0, 600));
    const buffer = await generateVoiceBuffer(clean);
    res.json({ audio: buffer.toString('base64') });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
