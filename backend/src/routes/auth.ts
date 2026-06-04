import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../memory/User';
import { requireSuperAdmin, signToken } from '../middleware/authMiddleware';

const router = Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) { res.status(400).json({ error: 'Usuario y contraseña requeridos' }); return; }

  const user = await User.findOne({ username: username.toLowerCase(), active: true });
  if (!user) { res.status(401).json({ error: 'Credenciales incorrectas' }); return; }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) { res.status(401).json({ error: 'Credenciales incorrectas' }); return; }

  const token = signToken({ userId: String(user._id), username: user.username, role: user.role });
  res.json({ token, user: { username: user.username, role: user.role } });
});

// ── GET /api/auth/users (superadmin) ─────────────────────────────────────────
router.get('/users', requireSuperAdmin, async (_req: Request, res: Response) => {
  const users = await User.find({}, 'username role active createdAt').sort({ createdAt: -1 });
  res.json({ users });
});

// ── POST /api/auth/users (superadmin) ────────────────────────────────────────
router.post('/users', requireSuperAdmin, async (req: Request, res: Response) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password) { res.status(400).json({ error: 'Usuario y contraseña requeridos' }); return; }
  if (!['superadmin', 'user'].includes(role)) { res.status(400).json({ error: 'Rol inválido' }); return; }

  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) { res.status(409).json({ error: 'El usuario ya existe' }); return; }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ username: username.toLowerCase(), passwordHash, role });
  res.status(201).json({ user: { username: user.username, role: user.role } });
});

// ── PATCH /api/auth/users/:id/toggle (superadmin) ────────────────────────────
router.patch('/users/:id/toggle', requireSuperAdmin, async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }
  if (user.role === 'superadmin') { res.status(403).json({ error: 'No se puede desactivar al superadmin' }); return; }
  user.active = !user.active;
  await user.save();
  res.json({ username: user.username, active: user.active });
});

// ── DELETE /api/auth/users/:id (superadmin) ──────────────────────────────────
router.delete('/users/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }
  if (user.role === 'superadmin') { res.status(403).json({ error: 'No se puede eliminar al superadmin' }); return; }
  await user.deleteOne();
  res.json({ ok: true });
});

export default router;
