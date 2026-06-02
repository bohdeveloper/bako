/**
 * Gap 3 — Proactividad: BAKO habla sin que le preguntes.
 *
 * Cron jobs (Europe/Madrid):
 *  05:45 L-V  Morning Briefing automático → Telegram voz
 *  08:30 L-V  Alertas inteligentes (PRs, repos, reunión temprana)
 *  18:00 V    Resumen semanal → Telegram voz
 *  22:00 L-V  Alerta Tracker vacío
 */

import cron from 'node-cron';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';
import { fetchGitHubData, getUserRepos } from '../tools/github';
import { getCalendarEvents } from '../tools/calendar';
import { getTrackerSummary, nowInSpain } from '../tools/cloudflare';
import { getNotionTasks } from '../tools/notion';
import { sendSystemMessage } from '../tools/telegram';

const WATCHED_REPOS = (process.env.PROACTIVITY_REPOS ?? 'diamadmin,unyona,ai-personal-os')
  .split(',')
  .map(r => r.trim().toLowerCase());

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
      const altas = pending.filter(t => t.prioridad === 'Alta');
      const extra = altas.length > 0 ? `, ${altas.length} de alta prioridad` : '';
      parts.push(`Tiene ${pending.length} tarea${pending.length > 1 ? 's' : ''} pendiente${pending.length > 1 ? 's' : ''} en Notion${extra}.`);
    } else {
      parts.push('No tiene tareas pendientes en Notion. Excelente semana, señor.');
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

// ─── Servicio principal ───────────────────────────────────────────────────────

export function startProactivityService(): void {
  const tz = 'Europe/Madrid';
  console.log('📡 BAKO Proactividad activa');

  // 05:45 L-V — Morning Briefing automático
  cron.schedule('45 5 * * 1-5', async () => {
    console.log('⏰ CRON: Morning Briefing automático (05:45)');
    try {
      const briefing = await runMorningBriefing();
      await sendSystemMessage(briefing, briefing);
    } catch (err) {
      console.error('❌ CRON Briefing:', (err as Error).message);
    }
  }, { timezone: tz });

  // 08:30 L-V — Alertas inteligentes
  cron.schedule('30 8 * * 1-5', async () => {
    console.log('⏰ CRON: Alertas inteligentes (08:30)');
    try {
      const alerts = await buildSmartAlerts();
      for (const a of alerts) {
        await sendSystemMessage(a.text, a.voice);
      }
    } catch (err) {
      console.error('❌ CRON Alertas:', (err as Error).message);
    }
  }, { timezone: tz });

  // 18:00 Viernes — Resumen semanal
  cron.schedule('0 18 * * 5', async () => {
    console.log('⏰ CRON: Resumen semanal (viernes 18:00)');
    try {
      const summary = await buildWeeklySummary();
      await sendSystemMessage(summary, summary);
    } catch (err) {
      console.error('❌ CRON Resumen semanal:', (err as Error).message);
    }
  }, { timezone: tz });

  // 22:00 L-V — Alerta Tracker vacío
  cron.schedule('0 22 * * 1-5', async () => {
    console.log('⏰ CRON: Verificando Tracker (22:00)');
    try {
      const tracker = await getTrackerSummary();
      if (tracker.tasks.length === 0) {
        await sendSystemMessage(
          '📊 Señor, el Tracker de hoy está vacío. ¿Quiere registrar las actividades del día?',
          'Señor, el Tracker de hoy está vacío. ¿Quiere registrar las actividades del día?'
        );
      }
    } catch (err) {
      console.error('❌ CRON Tracker check:', (err as Error).message);
    }
  }, { timezone: tz });
}
