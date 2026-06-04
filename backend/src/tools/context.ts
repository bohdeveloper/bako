/**
 * Contexto ambiental siempre activo de BAKO.
 * Tiempo (ciudad actual), ubicación, agenda y Tracker están disponibles en CADA respuesta.
 * Los datos se cachean para no llamar APIs en cada mensaje.
 */

import { getWeather, getWeatherForCity, WeatherData } from './weather';
import { getCalendarEvents, CalendarEvent } from './calendar';
import { getTrackerSummary, TrackerDaySummary, todayStringSpain, nowInSpain } from './cloudflare';

// ─── Caches ──────────────────────────────────────────────────────────────────

// Weather cacheado por ciudad (no único global)
const weatherByCity = new Map<string, { data: WeatherData; ts: number }>();
const WEATHER_TTL  = 10 * 60 * 1000; // 10 min — reducido para mayor precisión

let calendarCache: { data: CalendarEvent[]; ts: number } | null = null;
const CALENDAR_TTL = 60 * 1000; // 1 min — eventos reflejan cambios rápidamente

let trackerCache: { data: TrackerDaySummary; ts: number; date: string } | null = null;
const TRACKER_TTL  =  5 * 60 * 1000; // 5 min — cambia cuando Borja registra actividades

async function cachedWeatherForCity(city: string): Promise<WeatherData | null> {
  const key = city.toLowerCase().trim();
  const now = Date.now();
  const cached = weatherByCity.get(key);
  if (cached && now - cached.ts < WEATHER_TTL) return cached.data;

  try {
    const data = await getWeatherForCity(city);
    weatherByCity.set(key, { data, ts: now });
    return data;
  } catch {
    return cached?.data ?? null;
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

async function cachedTracker(): Promise<TrackerDaySummary | null> {
  const today = todayStringSpain();
  const now = Date.now();
  if (trackerCache && now - trackerCache.ts < TRACKER_TTL && trackerCache.date === today) {
    return trackerCache.data;
  }
  try {
    const data = await getTrackerSummary();
    trackerCache = { data, ts: now, date: today };
    return data;
  } catch {
    return (trackerCache?.date === today) ? trackerCache!.data : null;
  }
}

// Invalida el cache de una ciudad (llamar cuando cambia la ubicación)
export function invalidateCityWeatherCache(city: string): void {
  weatherByCity.delete(city.toLowerCase().trim());
}

// Invalida el cache del calendario (llamar tras crear/modificar eventos)
export function invalidateCalendarCache(): void {
  calendarCache = null;
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

  // Tiempo — extraer ciudad y normalizar Errentería→Donostia (misma área metro, mejor datos API)
  const commaIdx = location.indexOf(',');
  const rawCity  = commaIdx > -1 ? location.slice(commaIdx + 1).trim() : location;
  const weatherCity = /errenteria|errentería|renteria|rentería/i.test(rawCity)
    ? 'Donostia-San Sebastián'
    : rawCity;
  const w = await cachedWeatherForCity(weatherCity);
  if (w) {
    parts.push(`🌤 Tiempo en ${w.city}: ${w.current.temp}°C, ${w.current.description}, humedad ${w.current.humidity}%, viento ${w.current.windSpeed} km/h`);
    const hoy    = w.forecast[0];
    const manana = w.forecast[1];
    const pasado = w.forecast[2];
    if (hoy)    parts.push(`   Hoy: ${hoy.minTemp}–${hoy.maxTemp}°C, ${hoy.description}, lluvia ${hoy.rainProbability}%`);
    if (manana) parts.push(`   Mañana: ${manana.minTemp}–${manana.maxTemp}°C, ${manana.description}, lluvia ${manana.rainProbability}%`);
    if (pasado) parts.push(`   Pasado: ${pasado.minTemp}–${pasado.maxTemp}°C, ${pasado.description}, lluvia ${pasado.rainProbability}%`);
  }

  // Agenda — datos en tiempo real, separados en futuros y pasados
  const events  = await cachedCalendar();
  const realNow = new Date(); // UTC real para comparar con timestamps de eventos
  const hoyStr  = now.toDateString();

  const todayEvents = events.filter(e => new Date(e.start).toDateString() === hoyStr);
  const todayFuture = todayEvents.filter(e => e.allDay || new Date(e.start) > realNow);
  const todayPast   = todayEvents.filter(e => !e.allDay && new Date(e.start) <= realNow);
  const nextDays    = events.filter(e => new Date(e.start).toDateString() !== hoyStr);

  if (todayFuture.length > 0) {
    const list = todayFuture.map(e => {
      if (e.allDay) return e.title;
      const h = new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
      return `${e.title} a las ${h}`;
    }).join(', ');
    parts.push(`📆 Eventos restantes hoy: ${list}`);
  } else {
    parts.push(`📆 Sin eventos futuros hoy`);
  }

  if (todayPast.length > 0) {
    const list = todayPast.map(e => e.title).join(', ');
    parts.push(`   (Ya pasados hoy: ${list})`);
  }

  if (nextDays.length > 0) {
    const list = nextDays.slice(0, 3).map(e => {
      const d = new Date(e.start).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
      const h = e.allDay ? '' : ` ${new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`;
      return `${e.title} (${d}${h})`;
    }).join(' · ');
    parts.push(`   Próximos días: ${list}`);
  }

  // Tracker Personal — cacheado 5 min, siempre presente
  const tracker = await cachedTracker();
  if (tracker && tracker.tasks.length > 0) {
    const taskStr = tracker.tasks.map(t => {
      const icon = t.done === true ? '✅' : t.done === false ? '❌' : '⏳';
      return `${icon} ${t.name}`;
    }).join(', ');
    parts.push(`📊 Tracker Personal hoy (${tracker.completedCount}/${tracker.tasks.length} completadas): ${taskStr}`);
    if (tracker.note) parts.push(`   Nota del día: ${tracker.note}`);
  } else if (tracker) {
    parts.push(`📊 Tracker Personal: sin actividades programadas para hoy`);
  }

  return `CONTEXTO AMBIENTAL:\n${parts.join('\n')}`;
}
