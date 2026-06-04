import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { nowInSpain } from './cloudflare';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
}

function getAuth() {
  let clientId: string;
  let clientSecret: string;
  let token: object;

  // Producción (Render): leer desde variables de entorno
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_JSON) {
    clientId     = process.env.GOOGLE_CLIENT_ID;
    clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    token        = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
  } else {
    // Local: leer desde archivos
    const credPath  = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH ?? './credentials.json');
    const tokenPath = path.resolve(process.env.GOOGLE_TOKEN_PATH       ?? './token.json');

    if (!fs.existsSync(credPath))  throw new Error('credentials.json no encontrado — ejecuta el script de auth');
    if (!fs.existsSync(tokenPath)) throw new Error('token.json no encontrado — ejecuta: npx ts-node scripts/auth-google.ts');

    const { installed } = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    clientId     = installed.client_id;
    clientSecret = installed.client_secret;
    token        = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3000');
  auth.setCredentials(token);
  return auth;
}

export async function getCalendarEvents(days = 2): Promise<CalendarEvent[]> {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  // timeMin = inicio del día actual en Madrid (no el momento actual)
  // así los eventos pasados de hoy también aparecen en la agenda
  const nowMadrid      = nowInSpain();
  const realNow        = new Date();
  const offsetMs       = nowMadrid.getTime() - realNow.getTime();
  const midnightMadrid = new Date(nowMadrid.getFullYear(), nowMadrid.getMonth(), nowMadrid.getDate(), 0, 0, 0, 0);
  const timeMin        = new Date(midnightMadrid.getTime() - offsetMs);

  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + days);

  const { data } = await calendar.events.list({
    calendarId:   'primary',
    timeMin:      timeMin.toISOString(),
    timeMax:      timeMax.toISOString(),
    singleEvents: true,
    orderBy:      'startTime',
    maxResults:   20,
  });

  return (data.items ?? []).map((e) => {
    const allDay = Boolean(e.start?.date && !e.start?.dateTime);
    return {
      id:          e.id ?? '',
      title:       e.summary ?? '(Sin título)',
      start:       e.start?.dateTime ?? e.start?.date ?? '',
      end:         e.end?.dateTime   ?? e.end?.date   ?? '',
      allDay,
      location:    e.location    ?? undefined,
      description: e.description ?? undefined,
    };
  });
}

export async function createCalendarEvent(
  titulo: string,
  inicio: string,
  fin: string,
  opciones: { descripcion?: string; ubicacion?: string } = {}
): Promise<CalendarEvent> {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const { data } = await calendar.events.insert({
    calendarId:  'primary',
    requestBody: {
      summary: titulo,
      start:   { dateTime: inicio, timeZone: 'Europe/Madrid' },
      end:     { dateTime: fin,    timeZone: 'Europe/Madrid' },
      ...(opciones.descripcion ? { description: opciones.descripcion } : {}),
      ...(opciones.ubicacion   ? { location:    opciones.ubicacion   } : {}),
    },
  });

  return {
    id:          data.id ?? '',
    title:       data.summary ?? titulo,
    start:       data.start?.dateTime ?? inicio,
    end:         data.end?.dateTime   ?? fin,
    allDay:      false,
    location:    data.location    ?? undefined,
    description: data.description ?? undefined,
  };
}

export function formatEventsForSpeech(events: CalendarEvent[]): string {
  if (events.length === 0) return 'No tiene eventos próximos en el calendario.';

  const now   = new Date();
  const today = now.toDateString();

  const todayEvents    = events.filter(e => new Date(e.start).toDateString() === today);
  const tomorrowEvents = events.filter(e => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return new Date(e.start).toDateString() === d.toDateString();
  });

  const parts: string[] = [];

  if (todayEvents.length > 0) {
    const list = todayEvents.map(e => {
      if (e.allDay) return e.title;
      const hora = new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
      return `${e.title} a las ${hora}`;
    }).join(', ');
    parts.push(`Hoy tiene ${todayEvents.length === 1 ? 'un evento' : `${todayEvents.length} eventos`}: ${list}.`);
  } else {
    parts.push('Hoy no tiene eventos en el calendario.');
  }

  if (tomorrowEvents.length > 0) {
    const list = tomorrowEvents.map(e => {
      if (e.allDay) return e.title;
      const hora = new Date(e.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
      return `${e.title} a las ${hora}`;
    }).join(', ');
    parts.push(`Mañana: ${list}.`);
  }

  return parts.join(' ');
}
