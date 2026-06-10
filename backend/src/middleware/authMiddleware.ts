import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET ?? '';
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('🚨 JWT_SECRET no está definido — la app no puede arrancar en producción de forma segura');
    process.exit(1);
  } else {
    console.warn('⚠️  JWT_SECRET no definido — usando secret temporal solo para desarrollo local');
  }
}
const EFFECTIVE_SECRET = SECRET || 'bako-dev-secret-not-for-prod';

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

/** Comparación de tokens en tiempo constante para evitar timing attacks */
function timingSafeTokenCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
      // Longitudes distintas — hacemos la comparación igual para evitar timing leak
      crypto.timingSafeEqual(aBuf, aBuf);
      return false;
    }
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  // Compatibilidad con el token legacy del desktop Python
  const desktopToken = req.headers['x-desktop-token'];
  if (process.env.DESKTOP_TOKEN && typeof desktopToken === 'string' &&
      timingSafeTokenCompare(desktopToken, process.env.DESKTOP_TOKEN)) {
    req.authUser = { userId: 'desktop', username: 'desktop', role: 'superadmin' };
    next(); return;
  }
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'No autorizado' }); return; }
  try {
    const token = header.slice(7);
    req.authUser = jwt.verify(token, EFFECTIVE_SECRET) as AuthPayload;
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
  return jwt.sign(payload, EFFECTIVE_SECRET, { expiresIn: '30d' });
}
