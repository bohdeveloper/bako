/**
 * Contexto ambiental siempre activo de BAKO.
 * Tiempo, ubicación y agenda están disponibles en CADA respuesta,
 * sin necesidad de que el usuario mencione palabras clave.
 * Los datos se cachean para no llamar APIs en cada mensaje.
 */

import { getWeather, WeatherData } from './weather';
import { getCalendarEvents, CalendarEvent } from './calendar';
import { nowInSpain } from './cloudflare';

// ─── Caches ──────────────────────────────────────────────────────────────────

let weatherCache:  { data: WeatherData;     ts: number } | null = null;
let calendarCache: { data: CalendarEvent[]; ts: number } | null = null;

const WEATHER_TTL  = 30 * 60 * 1000; // 30 min — el tiempo no cambia tan rápido
const CALENDAR_TTL = 15 * 60 * 1000; // 15 min — la agenda puede tener eventos nuevos

async function cachedWeather(): Promise<WeatherData | null> {
  const now = Date.now();
  if (weatherCache && now - weatherCache.ts < WEATHER_TTL) return weatherCache.data;
  try {
    const data = await getWeather();
    weatherCache = { data, ts: now };
    return data;
  } catch {
    return weatherCache?.data ?? null; // datos obsoletos son mejor que nada
  }
}

async function cachedCalendar(): Promise<CalendarEvent[]> {
  const now = Date.now();
  if (calendarCache && now - calendarCache.ts < CALENDAR_TTL) return calendarCache.data;
  try {
    const data = await getCalendarEvents(3);
    calendarCache = { data, ts: now };
    return data;
  } catch {
    return calendarCache?.data ?? [];
  }
}

// ─── Contexto principal ───────────────────────────────────────────────────────

export async function getAmbientContext(
  location = process.env.WEATHER_CITY ?? 'Errentería'
): Promise<string> {
  const now   = nowInSpain();
  const hora  = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const fecha = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });

  const parts: string[] = [
    `📅 ${fecha} — 🕐 ${hora} (Europe/Madrid)`,
    `📍 Ubicación actual: ${location}`,
  ];

  // Tiempo — siempre presente, cacheado 30 min
  const w = await cachedWeather();
  if (w) {
    parts.push(`🌤 Tiempo en ${w.city}: ${w.current.temp}°C, ${w.current.description}, humedad ${w.current.humidity}%, viento ${w.current.windSpeed} km/h`);
    const hoy    = w.forecast[0];
    const manana = w.forecast[1];
    const pasado = w.forecast[2];
    if (hoy)    parts.push(`   Hoy: ${hoy.minTemp}–${hoy.maxTemp}°C, ${hoy.description}, lluvia ${hoy.rainProbability}%`);
    if (manana) parts.push(`   Mañana: ${manana.minTemp}–${manana.maxTemp}°C, ${manana.description}, lluvia ${manana.rainProbability}%`);
    if (pasado) parts.push(`   Pasado: ${pasado.minTemp}–${pasado.maxTemp}°C, ${pasado.description}, lluvia ${pasado.rainProbability}%`);
  }

  // Agenda — siempre presente, cacheada 15 min
  const events = await cachedCalendar();
  const hoyStr  = now.toDateString();
  const todayEvents    = events.filter(e => new Date(e.start).toDateString() === hoyStr);
  const upcomingEvents = events.filter(e => new Date(e.start).toDateString() !== hoyStr);

  if (todayEvents.length > 0) {
    const list = todayEvents.map(e => {
      if (e.allDay) return e.title;
      const h = new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      return `${e.title} a las ${h}`;
    }).join(', ');
    parts.push(`📆 Agenda hoy: ${list}`);
  } else {
    parts.push(`📆 Agenda hoy: sin eventos`);
  }

  if (upcomingEvents.length > 0) {
    const list = upcomingEvents.slice(0, 3).map(e => {
      const d = new Date(e.start).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
      const h = e.allDay ? '' : ` ${new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
      return `${e.title} (${d}${h})`;
    }).join(' · ');
    parts.push(`   Próximos: ${list}`);
  }

  return `CONTEXTO AMBIENTAL:\n${parts.join('\n')}`;
}
