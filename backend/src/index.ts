import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import agentRoutes from './routes/agent';
import desktopRoutes from './routes/desktop';
import bakoClientRoutes from './routes/bakoClient';
import { startTelegramBot } from './tools/telegram';
import { startProactivityService } from './services/ProactivityService';

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

app.use('/api/agent', agentRoutes);
app.use('/api/desktop', desktopRoutes);
app.use('/bako-client', bakoClientRoutes);

mongoose.connect(process.env.MONGODB_URI!)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch((err) => console.error('❌ Error MongoDB:', err));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  startTelegramBot();
  startProactivityService();
});