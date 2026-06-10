import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import agentRoutes from './routes/agent';
import { requireAuth } from './middleware/authMiddleware';
import desktopRoutes from './routes/desktop';
import bakoClientRoutes from './routes/bakoClient';
import authRoutes  from './routes/auth';
import peopleRoutes from './routes/people';
import projectsRoutes from './routes/projects';
import knowledgeRoutes from './routes/knowledge';
import notificationsRoutes from './routes/notifications';
import autoconfigRoutes from './routes/autoconfig';
import ttsRoutes from './routes/tts';
import pushRoutes from './routes/push';
import { startTelegramBot } from './tools/telegram';
import { startProactivityService } from './services/ProactivityService';
import { User } from './memory/User';
import { generalLimiter } from './middleware/security';

dotenv.config();

// Captura errores no controlados para que no cuelguen el proceso
process.on('uncaughtException',   (err) => console.error('🚨 UNCAUGHT EXCEPTION:', err.message, err.stack));
process.on('unhandledRejection',  (reason) => console.error('🚨 UNHANDLED REJECTION:', reason));

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://ai-personal-os.onrender.com', 'http://localhost:3001', 'http://localhost:5173'];

const app = express();

// Headers de seguridad HTTP (XSS, clickjacking, MIME sniffing, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],   // PWA usa inline scripts
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://ip-api.com', 'https://openrouter.ai', 'https://api.groq.com'],
      mediaSrc:   ["'self'", 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,  // necesario para audio/media en PWA
}));

app.use(cors({
  origin: (origin, callback) => {
    // Sin origin = curl, Postman o desktop Python (no navegador) → permitir
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-desktop-token'],
  credentials: true,
}));

app.use(express.json({ limit: '256kb' }));  // máximo 256KB por request — bloquea payloads masivos

// Rate limiter general para toda la API (200 req / 15 min)
app.use('/api', generalLimiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'AI Personal OS arrancado' });
});

app.get('/ping', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Archivos estáticos del cliente web
app.use('/bako-client', express.static(path.join(__dirname, '../public/bako-client')));

app.use('/api/auth',      authRoutes);
app.use('/api/people',    peopleRoutes);
app.use('/api/projects',  projectsRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/agent',         requireAuth, agentRoutes);
app.use('/api/desktop',       desktopRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/autoconfig',    autoconfigRoutes);
app.use('/api/tts',           ttsRoutes);
app.use('/api/push',          pushRoutes);
app.use('/bako-client', bakoClientRoutes);

// Error handler global — evita exponer stack traces al cliente en producción
import { ErrorRequestHandler } from 'express';
const globalErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  const isProd = process.env.NODE_ENV === 'production';
  console.error('🚨 Unhandled error:', err.message, err.stack);
  res.status(status).json({ error: isProd ? 'Error interno del servidor' : err.message });
};
app.use(globalErrorHandler);

mongoose.connect(process.env.MONGODB_URI!, {
  serverSelectionTimeoutMS: 8000,  // tiempo máximo para seleccionar servidor
  socketTimeoutMS:          10000, // tiempo máximo por operación (0=infinito por defecto!)
  connectTimeoutMS:         10000,
})
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
  startProactivityService().catch(err => console.error('❌ Proactividad:', err.message));
});