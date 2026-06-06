import { fetchGitHubData, GitHubData } from '../tools/github';
import { getWeather, WeatherData } from '../tools/weather';
import { getNews, NewsItem } from '../tools/news';
import { getNotionTasks, getNotionProjects, NotionTask, NotionProject } from '../tools/notion';
import { getCalendarEvents, formatEventsForSpeech, CalendarEvent } from '../tools/calendar';
import { getTrackerSummary, formatTrackerForSpeech, getBlogComments, formatCommentsForSpeech, nowInSpain } from '../tools/cloudflare';
import { getUnreadEmails, formatEmailsForSpeech } from '../tools/gmail';
import { speak } from '../tools/tts';
import { askClaude } from '../llm/claude';

function buildWeatherText(weather: WeatherData): string {
  const today    = weather.forecast[0];
  const tomorrow = weather.forecast[1];
  let text = `En ${weather.city} ahora mismo hay ${weather.current.temp} grados y está ${weather.current.description}.`;
  if (today) {
    text += ` Hoy entre ${today.minTemp} y ${today.maxTemp} grados`;
    if (today.rainProbability > 30) text += `, con ${today.rainProbability} por ciento de probabilidad de lluvia`;
    text += '.';
  }
  if (tomorrow) text += ` Mañana: entre ${tomorrow.minTemp} y ${tomorrow.maxTemp} grados, ${tomorrow.description}.`;
  return text;
}

async function buildNewsText(news: NewsItem[]): Promise<string> {
  if (news.length === 0) return 'No hay noticias disponibles ahora mismo.';
  const titles = news.slice(0, 5).map(n => `- ${n.title} (${n.source})`).join('\n');
  try {
    const summary = await askClaude(
      `Estos son los titulares de noticias de hoy:\n${titles}\n\nResúmelos en español en 2-3 frases naturales y fluidas, como si se los contaras a alguien en conversación. No uses listas ni viñetas. No traduzcas literalmente, usa tus propias palabras. Empieza directamente con el contenido.`,
      { useCloud: true, maxTokens: 160, temperature: 0.5 }
    );
    return `En las noticias de hoy: ${summary.trim()}`;
  } catch {
    const items = news.slice(0, 3).map(n => n.title).join('. Además, ');
    return `En las noticias de hoy: ${items}.`;
  }
}

function buildProjectsText(github: GitHubData): string {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const activeRepos = github.repos.filter(r => new Date(r.lastPushed) > oneWeekAgo);

  if (activeRepos.length === 0) return 'No hay actividad reciente en sus proyectos.';

  const parts: string[] = [];
  parts.push(`Sus proyectos activos son ${activeRepos.map(r => r.name).join(', ')}.`);

  if (github.recentCommits.length > 0) {
    const count    = github.recentCommits.length;
    const mainRepo = github.recentCommits[0].repo;
    parts.push(`Ayer realizó ${count} commit${count > 1 ? 's' : ''}, principalmente en ${mainRepo}.`);
  } else {
    parts.push('No hubo commits en las últimas 24 horas.');
  }

  if (github.openPRs.length > 0) {
    const n = github.openPRs.length;
    parts.push(`Tiene ${n} pull request${n > 1 ? 's' : ''} pendiente${n > 1 ? 's' : ''} de revisión.`);
  }

  return parts.join(' ');
}

function buildTasksText(notionTasks: NotionTask[], notionProjects: NotionProject[], github: GitHubData): string {
  const parts: string[] = [];

  // Proyectos con siguiente acción (activos primero)
  const activos   = notionProjects.filter(p => p.estado === 'Activo');
  const diferidos = notionProjects.filter(p => p.estado === 'Pausado');

  if (activos.length > 0) {
    const conAccion = activos.filter(p => p.siguiente_accion);
    if (conAccion.length > 0) {
      const resumen = conAccion.slice(0, 3)
        .map(p => `${p.nombre}: ${p.siguiente_accion}`)
        .join('; ');
      parts.push(`Proyectos activos — ${resumen}.`);
    } else {
      parts.push(`Tiene ${activos.length} proyecto${activos.length > 1 ? 's' : ''} activo${activos.length > 1 ? 's' : ''}: ${activos.map(p => p.nombre).join(', ')}.`);
    }
  }

  if (diferidos.length > 0) {
    parts.push(`Proyectos pausados: ${diferidos.map(p => p.nombre).join(', ')}.`);
  }

  // Issues pendientes en Notion
  if (notionTasks.length > 0) {
    const altas = notionTasks.filter(t => t.prioridad === 'Alta');
    const total = notionTasks.length;
    if (altas.length > 0) {
      parts.push(`Tiene ${total} issue${total > 1 ? 's' : ''} pendiente${total > 1 ? 's' : ''}, ${altas.length} de alta prioridad: ${altas.slice(0, 2).map(t => t.nombre).join(' y ')}.`);
    } else {
      parts.push(`Tiene ${total} issue${total > 1 ? 's' : ''} pendiente${total > 1 ? 's' : ''} en Notion.`);
    }
  }

  if (github.issues.length > 0) {
    const list = github.issues.slice(0, 3).map(i => i.title).join(', ');
    parts.push(`En GitHub: ${list}.`);
  }

  if (parts.length === 0) return 'No tiene tareas pendientes.';
  return parts.join(' ');
}

export async function runMorningBriefing(options: { speak?: boolean } = {}): Promise<string> {
  const now = nowInSpain();
  const hora = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const fecha = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  const [github, weather, news, notionTasks, notionProjects, calendarEvents, tracker, blogComments, unreadEmails] = await Promise.allSettled([
    fetchGitHubData(),
    getWeather(),
    getNews(),
    getNotionTasks(),
    getNotionProjects(),
    getCalendarEvents(2),
    getTrackerSummary(),
    getBlogComments(true),
    getUnreadEmails(10),
  ]);

  const gh           = github.status         === 'fulfilled' ? github.value         : null;
  const wx           = weather.status        === 'fulfilled' ? weather.value        : null;
  const nws          = news.status           === 'fulfilled' ? news.value           : [];
  const tasks        = notionTasks.status    === 'fulfilled' ? notionTasks.value    : [];
  const projects     = notionProjects.status === 'fulfilled' ? notionProjects.value : [];
  const events       = calendarEvents.status === 'fulfilled' ? calendarEvents.value : [];
  const trackerData  = tracker.status        === 'fulfilled' ? tracker.value        : null;
  const comments     = blogComments.status   === 'fulfilled' ? blogComments.value   : [];
  const emails       = unreadEmails.status   === 'fulfilled' ? unreadEmails.value   : [];

  const sections: string[] = [
    `Buenos días, señor. Son las ${hora} del ${fecha}. Soy BAKO, a su servicio.`,
  ];

  if (wx)  sections.push(buildWeatherText(wx));
  if (events.length > 0 || calendarEvents.status === 'fulfilled') {
    sections.push(formatEventsForSpeech(events));
  }
  sections.push(await buildNewsText(nws as NewsItem[]));
  if (gh)  sections.push(buildProjectsText(gh));
  if (gh)  sections.push(buildTasksText(tasks, projects, gh));
  else if (tasks.length > 0 || projects.length > 0) {
    sections.push(buildTasksText(tasks, projects, { repos: [], recentCommits: [], openPRs: [], issues: [], fetchedAt: '' }));
  }
  if (trackerData && trackerData.tasks.length > 0) sections.push(formatTrackerForSpeech(trackerData));
  if (emails.length > 0) sections.push(formatEmailsForSpeech(emails));
  if (comments.length > 0) sections.push(formatCommentsForSpeech(comments));

  const briefing = sections.join(' ');

  if (options.speak) {
    speak(briefing).catch(err => console.warn('TTS falló:', err));
  }

  return briefing;
}
