/**
 * Carga inicial de Notion — ejecutar UNA sola vez (o cuando quieras re-sincronizar).
 * Crea proyectos y tareas en Notion con los datos ya conocidos:
 *   - 5 proyectos del perfil (BAKO, bohdeveloper, Diamadmin, Unyona, Nitflex)
 *   - Issues abiertos de GitHub → tareas Notion
 *   - PRs abiertos de GitHub → tareas Notion
 *   - Tareas clave del roadmap BAKO
 *
 * Uso: npx ts-node scripts/seed-notion.ts
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getNotionProjects, getNotionTasks, createNotionProject, createNotionTask } from '../src/tools/notion';
import { fetchGitHubData } from '../src/tools/github';

// ─── Proyectos a crear ────────────────────────────────────────────────────────

const PROJECTS = [
  {
    nombre: 'BAKO',
    descripcion: 'Asistente personal autónomo con IA — voz, Telegram, GitHub, Notion, Calendar. MVP en producción en Render. Objetivo: mayordomo digital completo (Alfred/Jarvis).',
  },
  {
    nombre: 'bohdeveloper.com',
    descripcion: 'Portfolio personal. Next.js + Cloudflare Pages + Cloudflare D1. Incluye blog con comentarios y Tracker de hábitos diarios. Meta: conseguir clientes y visibilidad.',
  },
  {
    nombre: 'Diamadmin',
    descripcion: 'SaaS propio de administración. Angular + Spring Boot + PostgreSQL. URLs: app.diamadmin.com, diamadmin.com. En desarrollo activo con roadmap definido. Meta: producción con usuarios de pago.',
  },
  {
    nombre: 'Unyona',
    descripcion: 'SaaS en fase de validación. Landing en unyona.com para capturar leads antes de construir el producto. Meta: validar mercado antes de invertir en desarrollo.',
  },
  {
    nombre: 'Nitflex',
    descripcion: 'App de streaming — proyecto portfolio. React + TypeScript + Express + MongoDB + TMDB API. Pantalla principal funcionando.',
  },
];

// ─── Mapeo repo GitHub → proyecto Notion ─────────────────────────────────────

const REPO_TO_PROJECT: Array<{ pattern: RegExp; proyecto: string }> = [
  { pattern: /ai-personal-os|bako/i,  proyecto: 'BAKO' },
  { pattern: /bohdeveloper/i,         proyecto: 'bohdeveloper.com' },
  { pattern: /diamadmin/i,            proyecto: 'Diamadmin' },
  { pattern: /unyona/i,               proyecto: 'Unyona' },
  { pattern: /nitflex/i,              proyecto: 'Nitflex' },
];

function getProyectoForRepo(repoName: string): string {
  return REPO_TO_PROJECT.find(m => m.pattern.test(repoName))?.proyecto ?? repoName;
}

// ─── Tareas clave del roadmap BAKO ────────────────────────────────────────────

const ROADMAP_TASKS = [
  {
    nombre: '[BAKO] Ejecutar script de autostart Ollama + PM2 en Windows',
    prioridad: 'Alta' as const,
    proyecto: 'BAKO',
    notas: 'Ejecutar backend/scripts/setup-windows-autostart.ps1 como Administrador',
  },
  {
    nombre: '[BAKO] Gap 3: Configurar briefing automático a las 05:45 (cron job en Render)',
    prioridad: 'Alta' as const,
    proyecto: 'BAKO',
  },
  {
    nombre: '[BAKO] Gap 3: Motor de alertas proactivas (PRs sin revisar, deadlines, tracker vacío)',
    prioridad: 'Media' as const,
    proyecto: 'BAKO',
  },
  {
    nombre: '[BAKO] Gap 4: Detección de intención sin /comandos — texto libre puro',
    prioridad: 'Media' as const,
    proyecto: 'BAKO',
  },
  {
    nombre: '[BAKO] Fase 5: Integración Gmail API — resumen de correos sin leer',
    prioridad: 'Media' as const,
    proyecto: 'BAKO',
  },
  {
    nombre: '[BAKO] Fase 7: Panel admin en bohdeveloper.com/admin',
    prioridad: 'Baja' as const,
    proyecto: 'BAKO',
  },
  {
    nombre: '[BAKO] Gap 5: Wake word con OpenWakeWord en PC',
    prioridad: 'Baja' as const,
    proyecto: 'BAKO',
  },
];

// ─── Lógica principal ────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Iniciando seed de Notion...\n');

  // Cargar estado actual para evitar duplicados
  console.log('📥 Cargando proyectos y tareas existentes en Notion...');
  const [existingProjects, existingTasks] = await Promise.all([
    getNotionProjects(),
    getNotionTasks(),
  ]);

  const existingProjectNames = new Set(existingProjects.map(p => p.nombre.toLowerCase()));
  const existingTaskNames    = new Set(existingTasks.map(t => t.nombre.toLowerCase()));
  console.log(`   ↳ ${existingProjects.length} proyectos, ${existingTasks.length} tareas ya en Notion\n`);

  // ── 1. Proyectos ───────────────────────────────────────────────────────────
  console.log('📁 Creando proyectos...');
  for (const p of PROJECTS) {
    if (existingProjectNames.has(p.nombre.toLowerCase())) {
      console.log(`   ⏭  Ya existe: ${p.nombre}`);
      continue;
    }
    await createNotionProject(p.nombre, { descripcion: p.descripcion });
    console.log(`   ✅ Creado: ${p.nombre}`);
  }

  // ── 2. Issues y PRs de GitHub ──────────────────────────────────────────────
  console.log('\n🐙 Importando datos de GitHub...');
  let githubData;
  try {
    githubData = await fetchGitHubData();
    console.log(`   ↳ ${githubData.issues.length} issues abiertos, ${githubData.openPRs.length} PRs abiertos`);
  } catch (err) {
    console.warn(`   ⚠️  No se pudo conectar a GitHub: ${(err as Error).message}`);
    githubData = { issues: [], openPRs: [] };
  }

  console.log('\n📋 Creando tareas desde GitHub Issues...');
  for (const issue of githubData.issues) {
    const nombre = `[${issue.repo}] ${issue.title}`;
    if (existingTaskNames.has(nombre.toLowerCase())) {
      console.log(`   ⏭  Ya existe: ${nombre}`);
      continue;
    }
    await createNotionTask(nombre, {
      prioridad: 'Media',
      proyecto:  getProyectoForRepo(issue.repo),
    });
    console.log(`   ✅ Issue #${issue.number}: ${nombre}`);
  }

  console.log('\n🔀 Creando tareas desde GitHub PRs abiertos...');
  for (const pr of githubData.openPRs) {
    const nombre = `[PR][${pr.repo}] ${pr.title}`;
    if (existingTaskNames.has(nombre.toLowerCase())) {
      console.log(`   ⏭  Ya existe: ${nombre}`);
      continue;
    }
    await createNotionTask(nombre, {
      prioridad: 'Alta',
      proyecto:  getProyectoForRepo(pr.repo),
    });
    console.log(`   ✅ PR #${pr.number}: ${nombre}`);
  }

  // ── 3. Tareas del roadmap BAKO ─────────────────────────────────────────────
  console.log('\n🗺  Creando tareas del roadmap BAKO...');
  for (const task of ROADMAP_TASKS) {
    if (existingTaskNames.has(task.nombre.toLowerCase())) {
      console.log(`   ⏭  Ya existe: ${task.nombre}`);
      continue;
    }
    await createNotionTask(task.nombre, {
      prioridad: task.prioridad,
      proyecto:  task.proyecto,
    });
    console.log(`   ✅ [${task.prioridad}] ${task.nombre}`);
  }

  console.log('\n🎉 Seed completado.');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
