// @ts-nocheck
import * as path from 'path';
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Memory } from '../src/memory/Memory';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Usar Atlas en lugar de localhost
const ATLAS_URI = '***REMOVED-MONGODB-URI***';
process.env.MONGODB_URI = ATLAS_URI;

const MEMORIES = [
  // ─── HIGH ────────────────────────────────────────────────────────────────
  {
    content: 'Tiene relación laboral con LAE en Galicia, además de Inetum en Donostia. La reubicación a Galicia está directamente vinculada a este trabajo.',
    type: 'fact', importance: 'high', source: 'manual',
    tags: ['trabajo', 'galicia', 'lae'],
  },
  {
    content: 'En búsqueda activa en mercado laboral. Targets: Indra, NTT Data, Accenture, Teknei, startups remote-first. Rango: 40-55k€ España, 80-100k€ remoto.',
    type: 'fact', importance: 'high', source: 'manual',
    tags: ['trabajo', 'mercado', 'salario'],
  },
  {
    content: 'Filosofía de desarrollo: delega lo repetitivo, amplifica lo creativo, impacto mínimo en el código, elegancia sobre chapuzas.',
    type: 'preference', importance: 'high', source: 'manual',
    tags: ['filosofia', 'desarrollo'],
  },
  {
    content: 'AI Personal OS es el proyecto futuro ambicioso (18 meses, 800-1500€): 7 agentes ReAct especializados. BAKO es el MVP actual de ese sistema.',
    type: 'project_update', importance: 'high', source: 'manual',
    tags: ['ai-personal-os', 'roadmap'],
  },
  {
    content: 'Unyona: app pausada intencionalmente. Landing primero para validar. Identidad visual completa (logo, isotipo, favicon, app icon) ya definida.',
    type: 'decision', importance: 'high', source: 'manual',
    tags: ['unyona', 'estrategia'],
  },
  // ─── MEDIUM ──────────────────────────────────────────────────────────────
  {
    content: 'Stack preferido 2026: Next.js 14+ App Router, Zustand, Tailwind+shadcn/ui. Deploys: CF Pages (frontend), Railway/Fly.io (backend). n8n planificado.',
    type: 'preference', importance: 'medium', source: 'manual',
    tags: ['stack', 'tecnologia'],
  },
  {
    content: 'Usa Claude API (claude-sonnet-4) como herramienta IA principal en desarrollo. OpenAI GPT-4o fallback. Ollama local para privacidad.',
    type: 'fact', importance: 'medium', source: 'manual',
    tags: ['ia', 'herramientas', 'claude'],
  },
  {
    content: 'Regla crítica: NUNCA prefijo VITE_ para API keys privadas en Vite/React. Las VITE_ vars quedan expuestas en el bundle. Keys siempre en backend.',
    type: 'fact', importance: 'medium', source: 'manual',
    tags: ['seguridad', 'vite', 'reglas'],
  },
  {
    content: 'CF Pages = solo frontend estático. Backend siempre separado (Railway, Fly.io o CF Workers). No intentar correr Node.js en CF Pages.',
    type: 'fact', importance: 'medium', source: 'manual',
    tags: ['cloudflare', 'arquitectura', 'reglas'],
  },
  {
    content: 'bohdeveloper.com actualmente sin backend activo. Frontend-first puro. Backend futuro planeado: CF Workers + D1. No añadir hasta que sea necesario.',
    type: 'project_update', importance: 'medium', source: 'manual',
    tags: ['bohdeveloper', 'arquitectura'],
  },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('✅ MongoDB conectado\n');

  let saved = 0;
  for (const m of MEMORIES) {
    const prefix = m.content.slice(0, 40);
    const exists = await Memory.findOne({ content: { $regex: prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } });
    if (exists) { console.log(`⏭  Ya existe: ${prefix}...`); continue; }
    await Memory.create(m);
    const icon = m.importance === 'high' ? '🔴' : '🟡';
    console.log(`${icon} [${m.type}] ${m.content.slice(0, 70)}...`);
    saved++;
  }

  const total = await Memory.countDocuments();
  console.log(`\n✅ ${saved} memorias nuevas guardadas. Total en Atlas: ${total}`);
  await mongoose.disconnect();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
