import { Router, Request, Response } from 'express';
import path from 'path';

const router = Router();

// Sirve el cliente web BAKO (PWA) en /bako-client
router.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../public/bako-client/index.html'));
});

export default router;
