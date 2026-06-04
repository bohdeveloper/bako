import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'bako-secret-change-in-prod';

export interface AuthPayload {
  userId: string;
  username: string;
  role: 'superadmin' | 'user';
}

declare global {
  namespace Express {
    interface Request { authUser?: AuthPayload; }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  // Compatibilidad con el token legacy del desktop Python
  if (process.env.DESKTOP_TOKEN && req.headers['x-desktop-token'] === process.env.DESKTOP_TOKEN) {
    req.authUser = { userId: 'desktop', username: 'desktop', role: 'superadmin' };
    next(); return;
  }
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'No autorizado' }); return; }
  try {
    const token = header.slice(7);
    req.authUser = jwt.verify(token, SECRET) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.authUser?.role !== 'superadmin') { res.status(403).json({ error: 'Sólo el superadmin puede hacer esto' }); return; }
    next();
  });
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}
