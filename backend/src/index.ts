import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import agentRoutes from './routes/agent';
import desktopRoutes from './routes/desktop';
import bakoClientRoutes from './routes/bakoClient';
import authRoutes from './routes/auth';
import { startTelegramBot } from './tools/telegram';
import { startProactivityService } from './services/ProactivityService';
import { User } from './memory/User';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'AI Personal OS arrancado' });
});

app.get('/ping', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Archivos estáticos del cliente web
app.use('/bako-client', express.static(path.join(__dirname, '../public/bako-client')));

app.use('/api/auth',    authRoutes);
app.use('/api/agent',   agentRoutes);
app.use('/api/desktop', desktopRoutes);
app.use('/bako-client', bakoClientRoutes);

mongoose.connect(process.env.MONGODB_URI!)
  .then(async () => {
    console.log('✅ MongoDB conectado');
    await seedSuperAdmin();
  })
  .catch((err) => console.error('❌ Error MongoDB:', err));

// Crea el superadmin si no existe (usa ADMIN_USER / ADMIN_PASS del .env)
async function seedSuperAdmin() {
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminPass) return;
  const exists = await User.findOne({ role: 'superadmin' });
  if (exists) return;
  const passwordHash = await bcrypt.hash(adminPass, 10);
  await User.create({ username: adminUser.toLowerCase(), passwordHash, role: 'superadmin' });
  console.log(`✅ Superadmin creado: ${adminUser}`);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  startTelegramBot();
  startProactivityService();
});