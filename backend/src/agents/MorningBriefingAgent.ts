import { fetchGitHubData, GitHubData } from '../tools/github';
import { getWeather, WeatherData } from '../tools/weather';
import { getNews, NewsItem } from '../tools/news';
import { speak } from '../tools/tts';

function buildWeatherText(weather: WeatherData): string {
  const today = weather.forecast[0];
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

function buildNewsText(news: NewsItem[]): string {
  if (news.length === 0) return 'No hay noticias disponibles ahora mismo.';
  const items = news.slice(0, 3).map(n => n.title).join('. Además, ');
  return `En las noticias de hoy: ${items}.`;
}

function buildProjectsText(github: GitHubData): string {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const activeRepos = github.repos.filter(r => new Date(r.lastPushed) > oneWeekAgo);

  if (activeRepos.length === 0) return 'No hay actividad reciente en sus proyectos.';

  const parts: string[] = [];

  const repoNames = activeRepos.map(r => r.name).join(', ');
  parts.push(`Sus proyectos activos son ${repoNames}.`);

  if (github.recentCommits.length > 0) {
    const count = github.recentCommits.length;
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

function buildTasksText(github: GitHubData): string {
  if (github.issues.length === 0) return 'No tiene tareas pendientes en GitHub.';
  const list = github.issues.slice(0, 5).map(i => i.title).join('. Además, ');
  return `Sus tareas pendientes: ${list}.`;
}

export async function runMorningBriefing(options: { speak?: boolean } = {}): Promise<string> {
  const [github, weather, news] = await Promise.all([
    fetchGitHubData(),
    getWeather(),
    getNews(),
  ]);

  const greeting = 'Buenos días, señor.';

  const briefing = [
    greeting,
    'Soy BAKO, a su servicio.',
    buildWeatherText(weather),
    buildNewsText(news),
    buildProjectsText(github),
    buildTasksText(github),
  ].join(' ');

  if (options.speak) {
    speak(briefing).catch(err => console.warn('TTS falló:', err));
  }

  return briefing;
}
