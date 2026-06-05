/**
 * seedBrain.ts — migra los datos de profile.ts a las colecciones estructuradas de Atlas.
 * Idempotente: usa slug/clave como clave única para no duplicar.
 *
 * Ejecutar UNA SOLA VEZ:
 *   npx ts-node src/scripts/seedBrain.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { Project } from '../memory/Project';
import { KnowledgeEntry } from '../memory/KnowledgeEntry';

// ─── Proyectos ────────────────────────────────────────────────────────────────

const PROJECTS = [
  {
    nombre: 'BAKO',
    slug: 'bako',
    tipo: 'Sistema operativo personal con IA',
    estado: 'activo' as const,
    prioridad: 'alta' as const,
    descripcion: 'Mayordomo digital omnisciente. Evoluciona hacia JARVIS: cuerpo robótico, presencia física, voz, Telegram, GitHub.',
    siguiente_accion: 'Fase 7b-B desplegada — continuar con embeddings Ollama',
    stack: ['Node.js', 'TypeScript', 'Express', 'MongoDB Atlas', 'Groq', 'Ollama', 'Render', 'Telegram Bot'],
    urls: ['https://ai-personal-os.onrender.com'],
    horizonte: '3-5 años (robótico)',
    notas: ['MVP en producción en Render', 'Visión final: Jarvis de Iron Man en la vida real'],
  },
  {
    nombre: 'bohdeveloper.com',
    slug: 'bohdeveloper',
    tipo: 'Portfolio personal',
    estado: 'activo' as const,
    prioridad: 'media' as const,
    descripcion: 'Portfolio personal con Tracker diario y gestor de blog. Panel admin en /admin.',
    siguiente_accion: 'Continuar desarrollo — integración BAKO para marcar actividades',
    stack: ['Next.js', 'TypeScript', 'Cloudflare Pages', 'Cloudflare D1'],
    urls: ['https://bohdeveloper.com', 'https://bohdeveloper.com/admin'],
    horizonte: '2026',
    notas: ['Tracker diario: uso diario, integrado con BAKO', 'Blog con gestor en panel admin'],
  },
  {
    nombre: 'Diamadmin',
    slug: 'diamadmin',
    tipo: 'SaaS propio',
    estado: 'activo' as const,
    prioridad: 'alta' as const,
    descripcion: 'SaaS de gestión con roadmap definido.',
    stack: ['Angular', 'Spring Boot', 'PostgreSQL'],
    urls: ['https://app.diamadmin.com', 'https://diamadmin.com'],
    horizonte: '2026',
    notas: [],
  },
  {
    nombre: 'Unyona',
    slug: 'unyona',
    tipo: 'SaaS en validación',
    estado: 'activo' as const,
    prioridad: 'media' as const,
    descripcion: 'Landing para capturar leads antes de construir el producto.',
    urls: ['https://unyona.com'],
    horizonte: '2026',
    notas: [],
  },
  {
    nombre: 'Nitflex',
    slug: 'nitflex',
    tipo: 'App streaming — proyecto portfolio',
    estado: 'pausado' as const,
    prioridad: 'baja' as const,
    descripcion: 'Clon de Netflix con TMDB API. Home screen funcionando.',
    stack: ['React', 'TypeScript', 'Express', 'MongoDB', 'TMDB API'],
    horizonte: 'indefinido',
    notas: ['Proyecto portfolio — no prioritario'],
  },
  {
    nombre: 'Drones FPV',
    slug: 'drones-fpv',
    tipo: 'Hobby — cinematografía aérea',
    estado: 'diferido' as const,
    prioridad: 'baja' as const,
    descripcion: 'Aprender a pilotar drones FPV y hacer cinematografía aérea 4K en Galicia.',
    siguiente_accion: 'Arrancar tras mudanza a Galicia: simulador Liftoff → licencia A2 AESA',
    horizonte: 'post-Galicia (finales 2026+)',
    notas: ['~1.000€ primer drone 5"', 'Ruta: Liftoff → A2 AESA → drone → cinematografía'],
  },
  {
    nombre: 'Matrix Game',
    slug: 'matrix-game',
    tipo: 'Videojuego open-world',
    estado: 'diferido' as const,
    prioridad: 'baja' as const,
    descripcion: 'GTA V + Cyberpunk + Matrix lore. Mundo 5km², 200+ NPCs, economía funcional, hacking, combate parkour/gun-fu.',
    stack: ['Unreal Engine 5', 'C++', 'Blueprints', 'Blender', 'FMOD', 'Megascans'],
    horizonte: '4-6 años post-Galicia, 10-15h/semana',
    notas: ['Proyecto personal confidencial', 'Requiere aprender C++, 3D math y Blender antes de arrancar'],
  },
  {
    nombre: 'Proyecto Kefir Artesanal',
    slug: 'kefir',
    tipo: 'Negocio artesanal + e-commerce',
    estado: 'diferido' as const,
    prioridad: 'baja' as const,
    descripcion: 'Productor y vendedor de kefir artesanal en Galicia. Venta directa con suscripción recurrente.',
    stack: ['Next.js', 'PostgreSQL', 'Stripe'],
    horizonte: 'post-Galicia (finales 2026+)',
    notas: ['Objetivo: 1.500-2.500€/mes complementarios en 6-12 meses', 'Borja es productor + desarrollador — coste tech cero'],
  },
];

// ─── Conocimiento personal ────────────────────────────────────────────────────

const KNOWLEDGE = [
  // ── IDENTIDAD / HISTORIA
  { categoria: 'historia', clave: 'origen', valor: 'Borja, 34 años, Errentería, Gipuzkoa, País Vasco, España. Cumple 35 el 12 de julio de 2026.', importancia: 'alta' as const },
  { categoria: 'historia', clave: 'situacion_laboral', valor: 'Centro de empleabilidad Inetum (Donostia) — sin proyecto asignado. En búsqueda activa de empleo.', detalles: ['Oficina en Donostia-San Sebastián', 'Todos sus proyectos son personales — ninguno pertenece a Inetum'], importancia: 'alta' as const },
  { categoria: 'historia', clave: 'perfil_tecnico', valor: 'Developer Fullstack orientado a arquitectura de sistemas.', detalles: ['Frontend: React, Angular, Next.js, Tailwind, TypeScript', 'Backend: Express.js, Spring Boot, Node.js', 'BBDD: MongoDB, PostgreSQL', 'DevOps: Cloudflare, Docker básico, Git/GitHub', 'Aprendiendo: Agentes IA, Ollama, ML, Python para IA'], importancia: 'alta' as const },
  { categoria: 'historia', clave: 'pareja', valor: 'Yaimy — cubana, 36 años (cumple 2 de enero). Vive en Errentería con Borja. Trabaja en LAE (empresa gallega, NO empleador de Borja).', detalles: ['Aniversario: 9 de junio — 2 años en 2026', 'Plan: mudarse juntos a Galicia a finales de 2026 motivado por el trabajo de Yaimy en LAE', 'Padres cubanos Sofi y Osvaldo viven en Lezo. Yosiel (cuñado colombiano) vive en Lezo'], importancia: 'alta' as const },
  { categoria: 'historia', clave: 'mudanza_galicia', valor: 'Buscando activamente vivienda en Galicia — dentro de ~30km de Pontevedra Y Vigo simultáneamente.', detalles: ['Requisitos: pet-friendly, espacio exterior, fibra óptica', 'Zonas candidatas: Caldas de Reis (top), Cerdedo-Cotobade, Cuntis, A Estrada, Ponte Caldelas', 'Horizonte: finales 2026'], importancia: 'alta' as const },

  // ── VALORES / FILOSOFÍA
  { categoria: 'valores', clave: 'filosofia_base', valor: 'Estoicismo — Marcus Aurelius, Jonas Salzgeber. Disciplina diaria, control de lo que depende de uno.', importancia: 'alta' as const },
  { categoria: 'valores', clave: 'fortalezas', valor: 'Mentalidad arquitecto — diseña sistemas complejos con visión global. Fullstack moderno sin dependencias externas. Visión producto: piensa en el negocio, no solo en el código.', importancia: 'media' as const },

  // ── RUTINA
  { categoria: 'rutina', clave: 'rutina_diaria', valor: 'Despertar 05:00 (desde 8-jun-2026). Kronoshin 05:20-06:00. Bus a Donostia 06:30. Trabajo 07:00-14:00. Casa 15:00.', detalles: ['Lun/Vie 19:30-20:45 BIZIKI running', 'Mié 19:30-20:45 running', 'Mar/Jue 15:30-17:30 gym/Shaolin', 'Jue 18:00-19:00 psicólogo Donostia', 'Mar/Jue 21:00-22:00 lectura estoica', 'Sáb mañana: monte', 'Dom mañana: gym/Shaolin'], importancia: 'alta' as const },
  { categoria: 'rutina', clave: 'kronoshin', valor: 'Actividad diaria 05:20-06:00 L-V: ejercicios Shaolin + flexibilidad corporal. Se registra en el Tracker. NO es un proyecto de software.', importancia: 'alta' as const },
  { categoria: 'rutina', clave: 'entrenamiento', valor: 'Shaolin autodidacta en Fuerte de Arramendi. Running con grupo BIZIKI (Donostia-Errentería).', importancia: 'media' as const },

  // ── SALUD
  { categoria: 'salud', clave: 'psicologo', valor: 'Asiste a psicólogo todos los jueves 18:00-19:00 en Donostia.', importancia: 'media' as const },

  // ── OBJETIVOS
  { categoria: 'objetivos', clave: 'vision_vida', valor: 'Construir BAKO como mayordomo omnisciente + mudarse a Galicia con Yaimy + proyectos propios con ingresos pasivos.', importancia: 'alta' as const },
  { categoria: 'objetivos', clave: 'busqueda_empleo', valor: 'Búsqueda activa de nuevo empleo como developer fullstack. Actualmente en Inetum sin proyecto asignado.', importancia: 'alta' as const },

  // ── HOBBIES
  { categoria: 'hobbies', clave: 'intereses_principales', valor: 'Shaolin, running, naturaleza, estoicismo, videojuegos, cinematografía, IA, robótica.', importancia: 'baja' as const },

  // ── INFRAESTRUCTURA BAKO
  { categoria: 'otro', clave: 'infraestructura_bako', valor: 'Backend en Render (24/7). Ollama local vía Cloudflare Tunnel cuando PC encendido. Fallback automático a Groq.', detalles: ['Modelo local: Ollama qwen2.5-coder:7b — sin límites, privado, gratuito', 'Modelo nube: Groq llama-3.1-8b-instant — fallback automático', 'Túnel: Cloudflare Tunnel bako-ollama vía Task Scheduler', 'Groq límites: 20k tokens/min, 14.4k peticiones/día (reset 01:00 hora España)'], importancia: 'media' as const },
];

// ─── Ejecutar ─────────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('✅ MongoDB conectado');

  let projCreated = 0, projSkipped = 0;
  for (const p of PROJECTS) {
    const exists = await Project.findOne({ slug: p.slug });
    if (exists) { projSkipped++; continue; }
    await Project.create(p);
    projCreated++;
    console.log(`  🚀 Proyecto creado: ${p.nombre}`);
  }
  console.log(`\nProyectos: ${projCreated} creados, ${projSkipped} ya existían`);

  let knowCreated = 0, knowSkipped = 0;
  for (const k of KNOWLEDGE) {
    const exists = await KnowledgeEntry.findOne({ clave: k.clave });
    if (exists) { knowSkipped++; continue; }
    await KnowledgeEntry.create(k);
    knowCreated++;
    console.log(`  📚 Conocimiento creado: [${k.categoria}] ${k.clave}`);
  }
  console.log(`\nConocimiento: ${knowCreated} creado, ${knowSkipped} ya existía`);

  await mongoose.disconnect();
  console.log('\n✅ Seed completado.');
}

seed().catch(err => { console.error('❌ Error:', err); process.exit(1); });
