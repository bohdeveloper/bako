/**
 * Carga inicial de memoria de BAKO — ejecutar UNA sola vez.
 * Puebla la colección Memory con todo lo conocido sobre Borja.
 *
 * Uso: npx ts-node scripts/seed-memory.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Memory } from '../src/memory/Memory';

const MEMORIES = [

  // ─── VIDA Y METAS ────────────────────────────────────────────────────────

  {
    content: 'Está buscando activamente casa para reubicarse en Galicia, a ~30km de Pontevedra Y Vigo simultáneamente. Zona favorita: Caldas de Reis. Otras candidatas: Cerdedo-Cotobade, Cuntis, A Estrada, Ponte Caldelas. Requisitos: pet-friendly, espacio exterior y jardín, fibra óptica.',
    type: 'fact' as const,
    importance: 'high' as const,
    source: 'manual' as const,
    tags: ['galicia', 'vivienda', 'reubicacion', 'caldas-de-reis'],
  },
  {
    content: 'Su meta de vida a largo plazo es construir JARVIS: una IA autónoma con presencia física robótica. Horizonte 3-5 años. Está dispuesto a invertir ~500€ en hardware de forma incremental.',
    type: 'decision' as const,
    importance: 'high' as const,
    source: 'manual' as const,
    tags: ['jarvis', 'robotica', 'ia', 'meta-vida'],
  },
  {
    content: 'Quiere vivir y trabajar en remoto desde Galicia. Es su meta de vida a corto-medio plazo. Todo lo que construye (proyectos SaaS, portfolio, BAKO) apunta a conseguir independencia de ubicación.',
    type: 'decision' as const,
    importance: 'high' as const,
    source: 'manual' as const,
    tags: ['galicia', 'remoto', 'independencia', 'meta-vida'],
  },
  {
    content: 'Su filosofía de vida es el estoicismo — Marcus Aurelius, Jonas Salzgeber. Disciplina diaria, control de lo que depende de uno. Esto guía sus decisiones personales y profesionales.',
    type: 'preference' as const,
    importance: 'high' as const,
    source: 'manual' as const,
    tags: ['estoicismo', 'filosofia', 'disciplina', 'marcus-aurelio'],
  },
  {
    content: 'Quiere que BAKO sea un mayordomo digital completo (Alfred/Jarvis), no un chatbot. BAKO debe recordar, ejecutar acciones, anticipar necesidades y estar siempre disponible sin fricción.',
    type: 'preference' as const,
    importance: 'high' as const,
    source: 'manual' as const,
    tags: ['bako', 'vision', 'mayordomo', 'jarvis'],
  },
  {
    content: 'Trabaja en Inetum como Developer Fullstack, oficina en Donostia-San Sebastián. El proyecto JARVIS y sus SaaS personales son mundos completamente separados de Inetum — no mezclarlo nunca.',
    type: 'fact' as const,
    importance: 'high' as const,
    source: 'manual' as const,
    tags: ['inetum', 'trabajo', 'donostia', 'privacidad-laboral'],
  },

  // ─── PROYECTOS ───────────────────────────────────────────────────────────

  {
    content: 'Diamadmin es su SaaS propio más avanzado. Stack: Angular + Spring Boot + PostgreSQL. URLs: app.diamadmin.com y diamadmin.com. En desarrollo activo con roadmap definido. Meta: producción con usuarios reales de pago.',
    type: 'project_update' as const,
    importance: 'high' as const,
    source: 'manual' as const,
    tags: ['diamadmin', 'saas', 'angular', 'spring-boot', 'postgresql'],
  },
  {
    content: 'Unyona es su SaaS en fase de validación. URL: unyona.com. Tiene landing para capturar leads antes de construir el producto. Meta: validar con leads reales antes de invertir en desarrollo.',
    type: 'project_update' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['unyona', 'saas', 'validacion', 'leads'],
  },
  {
    content: 'bohdeveloper.com es su portfolio personal. Stack: Next.js + Cloudflare Pages + Cloudflare D1 (base de datos edge). Tiene blog con comentarios y Tracker de hábitos diarios. Meta: conseguir clientes freelance y visibilidad.',
    type: 'project_update' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['bohdeveloper', 'portfolio', 'nextjs', 'cloudflare', 'blog'],
  },
  {
    content: 'BAKO (Borja\'s Autonomous Knowledge Operator) es su sistema operativo personal con IA. MVP en producción en Render. Futuro: panel de administración en bohdeveloper.com/admin para configurarlo visualmente.',
    type: 'project_update' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['bako', 'ia', 'render', 'admin-panel'],
  },
  {
    content: 'Nitflex es un proyecto de portfolio: app de streaming (React + TypeScript + Express + MongoDB + TMDB API). Tiene la pantalla principal funcionando. No es su prioridad actual.',
    type: 'project_update' as const,
    importance: 'low' as const,
    source: 'manual' as const,
    tags: ['nitflex', 'streaming', 'portfolio', 'react'],
  },

  // ─── PERFIL TÉCNICO ──────────────────────────────────────────────────────

  {
    content: 'Stack tecnológico: Frontend — React, Angular, Next.js, Tailwind CSS, TypeScript. Backend — Express.js, Spring Boot, Node.js. Bases de datos — MongoDB, PostgreSQL. DevOps — Cloudflare, Docker básico, Git, GitHub.',
    type: 'fact' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['stack', 'tecnologia', 'react', 'angular', 'spring-boot', 'mongodb'],
  },
  {
    content: 'Está aprendiendo activamente: Agentes IA, Ollama, Machine Learning, Python para IA. Este aprendizaje alimenta directamente el proyecto BAKO y el objetivo JARVIS.',
    type: 'fact' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['aprendizaje', 'ia', 'ollama', 'machine-learning', 'python'],
  },
  {
    content: 'Se considera arquitecto de sistemas: diseña con visión global antes de codificar. Piensa en el negocio, no solo en el código. Fullstack moderno sin dependencias externas innecesarias.',
    type: 'preference' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['arquitectura', 'mentalidad', 'producto', 'fullstack'],
  },

  // ─── RUTINA Y VIDA PERSONAL ──────────────────────────────────────────────

  {
    content: 'Rutina diaria: 05:30 despierta. Meditación 20 min con Insight Timer. Entrenamiento matutino. 08:00-14:00 trabajo en Inetum (Donostia, bus desde Errentería). 19:00-21:00 entrenamiento tarde. 21:30 duerme.',
    type: 'fact' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['rutina', 'horario', 'meditacion', 'entrenamiento'],
  },
  {
    content: 'Practica Shaolin de forma autodidacta en el Fuerte de Arramendi (Errentería). Corre con el grupo BIZIKI en zona Donostia-Errentería. El entrenamiento físico y mental es parte central de su identidad.',
    type: 'fact' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['shaolin', 'running', 'biziki', 'arramendi', 'entrenamiento'],
  },
  {
    content: 'Vive en Errentería, Gipuzkoa, País Vasco. 37 años. Va a trabajar en bus (Errentería → Donostia-San Sebastián). Coordenadas: 43.3108, -1.8997.',
    type: 'fact' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['errenteria', 'gipuzkoa', 'ubicacion', 'edad'],
  },
  {
    content: 'Email personal: ohb.seven@gmail.com.',
    type: 'fact' as const,
    importance: 'low' as const,
    source: 'manual' as const,
    tags: ['email', 'contacto'],
  },
  {
    content: 'Quiere gestionar y configurar BAKO visualmente desde bohdeveloper.com/admin. Incluye: editar el perfil dinámico, ver memorias, historial de conversaciones, configurar tools y ver estadísticas de uso.',
    type: 'preference' as const,
    importance: 'medium' as const,
    source: 'manual' as const,
    tags: ['bako', 'admin', 'bohdeveloper', 'panel'],
  },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI no definido en .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Conectado a MongoDB Atlas');

  const existing = await Memory.countDocuments();
  if (existing > 0) {
    console.log(`⚠️  Ya existen ${existing} memorias en la base de datos.`);
    console.log('   Añadiendo las nuevas sin borrar las existentes...\n');
  }

  let saved = 0;
  for (const m of MEMORIES) {
    await Memory.create(m);
    console.log(`🧠 [${m.importance.toUpperCase()}] ${m.content.slice(0, 80)}...`);
    saved++;
  }

  const total = await Memory.countDocuments();
  console.log(`\n✅ ${saved} memorias cargadas. Total en BD: ${total}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
