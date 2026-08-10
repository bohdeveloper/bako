/**
 * Gap 3 — Proactividad: BAKO habla sin que le preguntes.
 */

import cron from 'node-cron';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { fetchGitHubData, getUserRepos, getPRFiles, getPRDetails } from '../tools/github';
import { getCalendarEvents } from '../tools/calendar';
import { nowInSpain } from '../tools/time';
import { getNotionTasks, getAllNotionProjects, esPrioridadCritica } from '../tools/notion';
import { sendSystemMessage } from '../tools/telegram';
import { Rule } from '../memory/Rule';
import { askClaude } from '../llm/claude';
import { checkStaleFields } from '../tools/profileDynamic';
import { getTechRadarItems } from '../tools/news';
import { AutoConfig, isJobEnabled } from '../memory/AutoConfig';

const WATCHED_REPOS = (process.env.PROACTIVITY_REPOS ?? 'diamadmin,unyona,ai-personal-os')
  .split(',')
  .map(r => r.trim().toLowerCase());

// ─── Horarios por defecto ─────────────────────────────────────────────────────

export const DEFAULT_SCHEDULES: Record<string, string> = {
  briefing:        '45 5 * * 1-5',
  alertas:         '30 8 * * 1-5',
  pr_review:       '30 8 * * 1-5',
  perfil:          '0 9 * * 1',
  techradar:       '30 9 * * 1',
  resumen_semanal: '0 18 * * 5',
};

// ─── Registro dinámico de tareas ──────────────────────────────────────────────

const runningTasks = new Map<string, ReturnType<typeof cron.schedule>>();
const jobCallbacks = new Map<string, () => Promise<void>>();

function registerTask(key: string, cronExpr: string, cb: () => Promise<void>): void {
  const existing = runningTasks.get(key);
  if (existing) existing.stop();
  const task = cron.schedule(cronExpr, cb, { timezone: 'Europe/Madrid' });
  runningTasks.set(key, task);
  jobCallbacks.set(key, cb);
}

export async function rescheduleJob(key: string, cronExpr: string): Promise<void> {
  const cb = jobCallbacks.get(key);
  if (!cb) {
    console.warn(`⚠️  rescheduleJob: '${key}' no registrado, saltando`);
    return;
  }
  registerTask(key, cronExpr, cb);
  console.log(`📅 Rescheduled '${key}' → ${cronExpr}`);
}

// ─── Resumen semanal ──────────────────────────────────────────────────────────

async function buildWeeklySummary(): Promise<string> {
  const now = nowInSpain();
  const dia = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  const [repos, tasks, events] = await Promise.allSettled([
    getUserRepos(),
    getNotionTasks(),
    getCalendarEvents(7),
  ]);

  const parts: string[] = [
    `Buenos días, señor. Es viernes ${dia}. Aquí tiene el resumen de la semana.`,
  ];

  if (repos.status === 'fulfilled') {
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const active = repos.value.filter(r => new Date(r.lastPushed) > oneWeekAgo);
    if (active.length > 0) {
      parts.push(
        `Esta semana hubo actividad en ${active.length} repositorio${active.length > 1 ? 's' : ''}: ${active.map(r => r.name).join(', ')}.`
      );
    } else {
      parts.push('No hubo actividad en repositorios esta semana.');
    }
  }

  if (tasks.status === 'fulfilled') {
    const pending = tasks.value;
    if (pending.length > 0) {
      const criticas = pending.filter(t => esPrioridadCritica(t.prioridad));
      const extra = criticas.length > 0 ? `, ${criticas.length} de prioridad crítica` : '';
      parts.push(`Tiene ${pending.length} issue${pending.length > 1 ? 's' : ''} pendiente${pending.length > 1 ? 's' : ''} en Notion${extra}.`);
    } else {
      parts.push('No tiene issues pendientes en Notion. Excelente semana, señor.');
    }
  }

  if (events.status === 'fulfilled' && events.value.length > 0) {
    const nextEvents = events.value.slice(0, 3).map(e => {
      const fecha = new Date(e.start).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
      if (e.allDay) return `${e.title} (${fecha})`;
      const hora = new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      return `${e.title} el ${fecha} a las ${hora}`;
    }).join(', ');
    parts.push(`La próxima semana tiene: ${nextEvents}.`);
  }

  return parts.join(' ');
}

// ─── Alertas inteligentes ─────────────────────────────────────────────────────

async function buildSmartAlerts(): Promise<{ text: string; voice: string }[]> {
  const alerts: { text: string; voice: string }[] = [];
  const now = nowInSpain();

  // 1. Repos vigilados sin commits en 3+ días
  try {
    const repos = await getUserRepos();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    for (const name of WATCHED_REPOS) {
      const repo = repos.find(r => r.name.toLowerCase() === name);
      if (repo && new Date(repo.lastPushed) < threeDaysAgo) {
        const days = Math.floor((now.getTime() - new Date(repo.lastPushed).getTime()) / 86_400_000);
        alerts.push({
          text:  `💤 Lleva *${days} días* sin commits en *${repo.name}*. ¿Bloqueado?`,
          voice: `Lleva ${days} días sin commits en ${repo.name}. ¿Está bloqueado?`,
        });
      }
    }
  } catch (err) {
    console.warn('⚠️  Alerta repos:', (err as Error).message);
  }

  // 2. PRs con 2+ días sin actividad
  try {
    const gh = await fetchGitHubData();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const stale = gh.openPRs.filter(pr => new Date(pr.updatedAt) < twoDaysAgo);
    if (stale.length > 0) {
      const list = stale.map(pr => `#${pr.number} ${pr.title}`).join(', ');
      alerts.push({
        text:  `🔀 Tiene *${stale.length} PR${stale.length > 1 ? 's' : ''}* sin actividad hace 2+ días: ${list}`,
        voice: `Tiene ${stale.length} pull request${stale.length > 1 ? 's' : ''} sin actividad desde hace más de dos días.`,
      });
    }
  } catch (err) {
    console.warn('⚠️  Alerta PRs:', (err as Error).message);
  }

  // 3. Reunión mañana antes de las 9:00
  try {
    const events = await getCalendarEvents(2);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toDateString();

    const earlyEvents = events.filter(e => {
      if (new Date(e.start).toDateString() !== tomorrowStr) return false;
      if (e.allDay) return false;
      return new Date(e.start).getHours() < 9;
    });

    if (earlyEvents.length > 0) {
      const e = earlyEvents[0];
      const hora = new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      alerts.push({
        text:  `⏰ Mañana tiene *${e.title}* a las ${hora}. ¿Quiere el briefing antes de salir?`,
        voice: `Mañana tiene ${e.title} a las ${hora}. ¿Quiere el briefing antes de salir?`,
      });
    }
  } catch (err) {
    console.warn('⚠️  Alerta reunión:', (err as Error).message);
  }

  return alerts;
}

// ─── Motor de reglas configurables ───────────────────────────────────────────

async function evaluateCustomRules(): Promise<{ text: string; voice: string }[]> {
  const rules = await Rule.find({ active: true });
  if (rules.length === 0) return [];

  const now = nowInSpain();
  const [repos, tasks, events] = await Promise.allSettled([
    getUserRepos(),
    getNotionTasks(),
    getCalendarEvents(3),
  ]);

  const context = {
    fechaHora: now.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }),
    repos: repos.status === 'fulfilled'
      ? repos.value.map(r => ({
          nombre: r.name,
          diasSinCommit: Math.floor((now.getTime() - new Date(r.lastPushed).getTime()) / 86_400_000),
        }))
      : [],
    tareas: tasks.status === 'fulfilled'
      ? tasks.value.map(t => ({ nombre: t.nombre, prioridad: t.prioridad }))
      : [],
    eventos: events.status === 'fulfilled'
      ? events.value.slice(0, 5).map(e => ({ titulo: e.title, inicio: e.start }))
      : [],
  };

  const rulesList = rules.map((r, i) => `${i + 1}. ${r.description}`).join('\n');

  let raw: string;
  try {
    raw = await askClaude(
      `Evalúa estas reglas contra el contexto actual y determina cuáles se cumplen.\n\nReglas:\n${rulesList}\n\nContexto:\n${JSON.stringify(context, null, 2)}`,
      {
        systemPrompt: `Eres un motor de evaluación de reglas. Responde SOLO con JSON válido, sin texto adicional:
[{"index":1,"triggered":true,"mensaje":"Mensaje breve de alerta en español"},{"index":2,"triggered":false,"mensaje":""}]`,
        maxTokens: 400,
        useCloud: true,
      }
    );
  } catch {
    return [];
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let evaluations: Array<{ index: number; triggered: boolean; mensaje: string }>;
  try {
    evaluations = JSON.parse(match[0]);
  } catch {
    return [];
  }

  const alerts: { text: string; voice: string }[] = [];
  for (const result of evaluations) {
    if (result.triggered && result.mensaje) {
      const rule = rules[result.index - 1];
      if (rule) {
        alerts.push({
          text:  `🔔 *Regla:* ${result.mensaje}`,
          voice: result.mensaje,
        });
        await Rule.findByIdAndUpdate(rule._id, { lastTriggered: new Date() });
      }
    }
  }

  return alerts;
}

// ─── Tech Radar semanal ───────────────────────────────────────────────────────

export async function buildTechRadar(): Promise<string | null> {
  const items = await getTechRadarItems(5);
  if (!items.length) return null;

  const listJson = JSON.stringify(
    items.map(i => ({ titulo: i.title, fuente: i.source, url: i.link }))
  );

  // Los proyectos salen de Notion — sin lista fija que se quede obsoleta
  const proyectos = await getAllNotionProjects()
    .then(ps => ps
      .filter(p => !/completado|abandonado/i.test(p.estado))
      .map(p => `${p.nombre}${p.descripcion ? ` (${p.descripcion})` : ''}`)
      .join(', '))
    .catch(() => '');

  const raw = await askClaude(listJson, {
    systemPrompt: `Eres el Tech Radar semanal de BAKO. El stack de Borja: React, TypeScript, Node.js, Express, Next.js, MongoDB, AI/ML (aprendiendo).${proyectos ? ` Sus proyectos: ${proyectos}.` : ''}

Filtra las 5 noticias o artículos más relevantes para su stack y proyectos. Descarta noticias genéricas de negocios, política o ajenas al desarrollo.

Responde SOLO con JSON válido, sin texto adicional:
[{"titulo":"...","fuente":"...","url":"...","relevancia":"una frase corta de por qué le interesa a Borja"}]`,
    maxTokens: 600,
    useCloud: true,
  });

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;

  let picks: Array<{ titulo: string; fuente: string; url: string; relevancia: string }>;
  try { picks = JSON.parse(match[0]); } catch { return null; }

  const lines = picks.slice(0, 5).map((p, i) =>
    `${i + 1}. *${p.titulo}* — _${p.fuente}_\n   ${p.relevancia}${p.url ? `\n   ${p.url}` : ''}`
  );

  return `🛰 *Tech Radar semanal*\n\nLas novedades más relevantes para su stack esta semana:\n\n${lines.join('\n\n')}`;
}

// ─── PR Review automático ─────────────────────────────────────────────────────

const reviewedPRs = new Set<string>();

export async function buildPRReviews(): Promise<{ text: string; voice: string }[]> {
  const username = process.env.GITHUB_USERNAME;
  if (!username) return [];

  const gh = await fetchGitHubData();
  if (!gh.openPRs.length) return [];

  const since = new Date(Date.now() - 24 * 3_600_000);
  const fresh  = gh.openPRs.filter(pr =>
    WATCHED_REPOS.includes(pr.repo.toLowerCase()) &&
    new Date(pr.updatedAt) > since
  );
  if (!fresh.length) return [];

  const results: { text: string; voice: string }[] = [];

  for (const pr of fresh) {
    const key = `${pr.repo}#${pr.number}@${pr.updatedAt}`;
    if (reviewedPRs.has(key)) continue;

    const [details, files] = await Promise.all([
      getPRDetails(pr.repo, pr.number),
      getPRFiles(pr.repo, pr.number),
    ]);
    if (!details) continue;

    const totalChanges = details.additions + details.deletions;
    const diffSummary = totalChanges <= 500
      ? files.map(f => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions}):\n${(f.patch ?? '').slice(0, 800)}`).join('\n\n---\n\n')
      : files.map(f => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n');

    const prompt = `PR #${pr.number} en ${pr.repo}: "${details.title}"
${details.body ? `Descripción: ${details.body.slice(0, 300)}` : ''}
Commits: ${details.commits} · +${details.additions}/-${details.deletions} líneas

Cambios:
${diffSummary.slice(0, 2500)}`;

    let review: string;
    try {
      review = await askClaude(prompt, {
        systemPrompt: `Eres un senior developer revisando un PR. Responde en español, de forma directa y sin rodeos. Estructura tu revisión en 3 secciones:
1. **Resumen** (1-2 frases de qué hace este PR)
2. **⚠️ Posibles problemas** (bugs, edge cases, seguridad — si no hay, escribe "Sin problemas detectados")
3. **💡 Sugerencias** (mejoras concretas — máximo 2-3 puntos)`,
        maxTokens: 500,
        useCloud: true,
      });
    } catch {
      continue;
    }

    reviewedPRs.add(key);
    results.push({
      text:  `🔀 *PR Review: #${pr.number} — ${pr.title}* (${pr.repo})\n${pr.url}\n\n${review}`,
      voice: `Revisión del pull request número ${pr.number} en ${pr.repo}: ${pr.title}. ${review.replace(/\*\*/g, '').replace(/#+/g, '').slice(0, 300)}`,
    });
  }

  return results;
}

// ─── Callbacks de los jobs ────────────────────────────────────────────────────

async function runBriefingJob(): Promise<void> {
  if (!await isJobEnabled('briefing')) return;
  console.log('⏰ CRON: Morning Briefing automático');
  try {
    const briefing = await runMorningBriefing();
    await sendSystemMessage(briefing, briefing);
  } catch (err) { console.error('❌ CRON Briefing:', (err as Error).message); }
}

async function runAlertasJob(): Promise<void> {
  if (!await isJobEnabled('alertas')) return;
  console.log('⏰ CRON: Alertas inteligentes + Reglas');
  try {
    const [smartAlerts, ruleAlerts] = await Promise.allSettled([
      buildSmartAlerts(),
      evaluateCustomRules(),
    ]);
    const allAlerts = [
      ...(smartAlerts.status === 'fulfilled' ? smartAlerts.value : []),
      ...(ruleAlerts.status  === 'fulfilled' ? ruleAlerts.value  : []),
    ];
    for (const a of allAlerts) await sendSystemMessage(a.text, a.voice);
  } catch (err) { console.error('❌ CRON Alertas:', (err as Error).message); }
}

async function runPRReviewJob(): Promise<void> {
  if (!await isJobEnabled('pr_review')) return;
  console.log('⏰ CRON: PR Reviews automáticos');
  try {
    const prAlerts = await buildPRReviews();
    for (const a of prAlerts) await sendSystemMessage(a.text, a.voice);
  } catch (err) { console.error('❌ CRON PR Reviews:', (err as Error).message); }
}

async function runPerfilJob(): Promise<void> {
  if (!await isJobEnabled('perfil')) return;
  console.log('⏰ CRON: Verificación perfil dinámico');
  try {
    const staleAlerts = await checkStaleFields(90);
    for (const alert of staleAlerts) {
      await sendSystemMessage(
        `🔄 *Perfil posiblemente desactualizado:* ${alert}\nPuedes actualizar con \`/perfil\` o diciéndome el cambio directamente.`,
        alert
      );
    }
  } catch (err) { console.error('❌ CRON Perfil staleness:', (err as Error).message); }
}

async function runTechRadarJob(): Promise<void> {
  if (!await isJobEnabled('techradar')) return;
  console.log('⏰ CRON: Tech Radar semanal');
  try {
    const radar = await buildTechRadar();
    if (radar) {
      const voice = radar.replace(/\*|_/g, '').replace(/https?:\/\/\S+/g, '').slice(0, 400);
      await sendSystemMessage(radar, `Tech Radar de la semana. ${voice}`);
    }
  } catch (err) { console.error('❌ CRON Tech Radar:', (err as Error).message); }
}

async function runResumenSemanalJob(): Promise<void> {
  if (!await isJobEnabled('resumen_semanal')) return;
  console.log('⏰ CRON: Resumen semanal');
  try {
    const summary = await buildWeeklySummary();
    await sendSystemMessage(summary, summary);
  } catch (err) { console.error('❌ CRON Resumen semanal:', (err as Error).message); }
}

// ─── Servicio principal ───────────────────────────────────────────────────────

export async function startProactivityService(): Promise<void> {
  console.log('📡 BAKO Proactividad activa');

  // Leer horarios personalizados guardados en BD (clave: schedule_<jobKey>)
  const allConfigs = await AutoConfig.find().lean().catch(() => []);
  const schedMap: Record<string, string> = {};
  allConfigs
    .filter(c => c.key.startsWith('schedule_') && c.value)
    .forEach(c => { schedMap[c.key.replace('schedule_', '')] = c.value!; });

  const s = (key: string) => schedMap[key] ?? DEFAULT_SCHEDULES[key];

  registerTask('briefing',        s('briefing'),        runBriefingJob);
  registerTask('alertas',         s('alertas'),         runAlertasJob);
  registerTask('pr_review',       s('pr_review'),       runPRReviewJob);
  registerTask('perfil',          s('perfil'),          runPerfilJob);
  registerTask('techradar',       s('techradar'),       runTechRadarJob);
  registerTask('resumen_semanal', s('resumen_semanal'), runResumenSemanalJob);
}
