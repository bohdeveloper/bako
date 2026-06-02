import axios from 'axios';

const BASE = 'https://api.cloudflare.com/client/v4';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function getDbId(): string {
  const id = process.env.CLOUDFLARE_D1_DB_ID;
  if (!id) throw new Error('CLOUDFLARE_D1_DB_ID no definido en .env');
  return id;
}

function getAccountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) throw new Error('CLOUDFLARE_ACCOUNT_ID no definido en .env');
  return id;
}

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { data } = await axios.post(
    `${BASE}/accounts/${getAccountId()}/d1/database/${getDbId()}/query`,
    { sql, params },
    { headers: getHeaders() }
  );
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? 'D1 query failed');
  return data.result[0].results as T[];
}

// ─── Timezone ─────────────────────────────────────────────────────────────────

export function nowInSpain(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
}

export function todayStringSpain(): string {
  const d = nowInSpain();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// day_index: 0=Lunes … 6=Domingo (semana empieza en lunes)
function todayDayIndex(): number {
  const jsDay = nowInSpain().getDay(); // 0=Dom, 1=Lun...
  return (jsDay + 6) % 7;
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

// ─── Tracker ──────────────────────────────────────────────────────────────────

export interface TrackerTask {
  activity_id: string;
  name: string;
  start_min: number;
  end_min: number;
  description: string;
}

export interface TrackerRecord {
  activity_id: string;
  done: number;
  reason: string | null;
}

export interface TrackerDaySummary {
  date: string;
  timeInSpain: string;
  tasks: Array<{
    name: string;
    time: string;
    done: boolean | null; // null = aún no registrado
    reason?: string;
  }>;
  completedCount: number;
  pendingCount: number;
  notDoneCount: number;
  note: string | null;
}

export async function getTrackerSummary(dateStr?: string): Promise<TrackerDaySummary> {
  const date      = dateStr ?? todayStringSpain();
  const dayIndex  = dateStr ? undefined : todayDayIndex();
  const now       = nowInSpain();
  const timeInSpain = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  // Tareas trackeables del día
  let tasks: TrackerTask[];
  if (dayIndex !== undefined) {
    tasks = await query<TrackerTask>(
      'SELECT activity_id, name, start_min, end_min, description FROM tracker_tasks WHERE user_id=1 AND day_index=? AND track=1 ORDER BY start_min',
      [dayIndex]
    );
  } else {
    // Si se pasa una fecha específica, calcular el day_index de esa fecha
    const d = new Date(date);
    const idx = (d.getDay() + 6) % 7;
    tasks = await query<TrackerTask>(
      'SELECT activity_id, name, start_min, end_min, description FROM tracker_tasks WHERE user_id=1 AND day_index=? AND track=1 ORDER BY start_min',
      [idx]
    );
  }

  // Registros del día
  const records = await query<TrackerRecord>(
    'SELECT activity_id, done, reason FROM tracker_records WHERE date=? AND user_id=1',
    [date]
  );

  const recordMap = new Map(records.map(r => [r.activity_id, r]));

  // Nota del día
  const notes = await query<{ note: string }>('SELECT note FROM tracker_notes WHERE date=? AND user_id=1 LIMIT 1', [date]);
  const note = notes[0]?.note ?? null;

  const enriched = tasks.map(t => {
    const rec = recordMap.get(t.activity_id);
    return {
      name:   t.name,
      time:   `${minutesToTime(t.start_min)}–${minutesToTime(t.end_min)}`,
      done:   rec ? Boolean(rec.done) : null,
      reason: rec?.reason ?? undefined,
    };
  });

  return {
    date,
    timeInSpain,
    tasks: enriched,
    completedCount: enriched.filter(t => t.done === true).length,
    pendingCount:   enriched.filter(t => t.done === null).length,
    notDoneCount:   enriched.filter(t => t.done === false).length,
    note,
  };
}

export async function markTrackerRecord(
  activityName: string,
  done: boolean,
  reason?: string,
  dateStr?: string
): Promise<{ success: boolean; taskName: string; message: string }> {
  const date     = dateStr ?? todayStringSpain();
  const dayIndex = (() => { const d = new Date(date); return (d.getDay() + 6) % 7; })();

  // Buscar la tarea por nombre aproximado (case-insensitive, búsqueda parcial)
  const tasks = await query<TrackerTask & { activity_id: string }>(
    `SELECT activity_id, name, start_min, end_min FROM tracker_tasks
     WHERE user_id=1 AND day_index=? AND track=1 AND LOWER(name) LIKE LOWER(?)`,
    [dayIndex, `%${activityName}%`]
  );

  if (tasks.length === 0) {
    // Buscar sin filtro de día para dar mejor feedback
    const allTasks = await query<{ name: string }>(
      'SELECT DISTINCT name FROM tracker_tasks WHERE user_id=1 AND track=1 ORDER BY name'
    );
    const names = allTasks.map(t => t.name).join(', ');
    return {
      success: false,
      taskName: activityName,
      message: `No encontré ninguna tarea llamada "${activityName}" para hoy. Tareas disponibles: ${names}.`,
    };
  }

  const task = tasks[0];

  // UPSERT — insertar o actualizar el registro
  await query(
    `INSERT INTO tracker_records (date, activity_id, day_index, done, reason, user_id)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(date, activity_id) DO UPDATE SET done=excluded.done, reason=excluded.reason, updated_at=CURRENT_TIMESTAMP`,
    [date, task.activity_id, dayIndex, done ? 1 : 0, reason ?? null]
  );

  const estado = done ? 'completada' : 'marcada como no completada';
  return {
    success: true,
    taskName: task.name,
    message: `${task.name} ${estado} en el Tracker para el ${date}.`,
  };
}

export function formatTrackerForSpeech(summary: TrackerDaySummary): string {
  const { tasks, completedCount, pendingCount, notDoneCount, note, timeInSpain } = summary;

  if (tasks.length === 0) return 'No hay actividades trackeadas para hoy.';

  const parts: string[] = [];
  parts.push(`Son las ${timeInSpain} en España.`);

  if (completedCount > 0) {
    const names = tasks.filter(t => t.done).map(t => t.name).join(', ');
    parts.push(`Completadas: ${names}.`);
  }

  if (notDoneCount > 0) {
    const notDone = tasks.filter(t => t.done === false);
    notDone.forEach(t => {
      parts.push(`${t.name} no completada${t.reason ? `: ${t.reason}` : '.'}`);
    });
  }

  if (pendingCount > 0) {
    const names = tasks.filter(t => t.done === null).map(t => t.name).join(', ');
    parts.push(`Pendiente de registrar: ${names}.`);
  }

  if (note) parts.push(`Nota del día: ${note}`);

  return parts.join(' ');
}

// ─── Blog comments ────────────────────────────────────────────────────────────

export interface BlogComment {
  id: number;
  alias: string;
  body: string;
  created_at: string;
  approved: number;
  post_title: string;
  post_slug: string;
}

export async function getBlogComments(onlyNew = false): Promise<BlogComment[]> {
  const since = onlyNew ? (() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })() : '2000-01-01';

  return query<BlogComment>(
    `SELECT bc.id, bc.alias, bc.body, bc.created_at, bc.approved,
            bp.title AS post_title, bp.slug AS post_slug
     FROM blog_comments bc
     JOIN blog_posts bp ON bc.post_id = bp.id
     WHERE bc.created_at >= ? AND bc.approved = 1
     ORDER BY bc.created_at DESC
     LIMIT 10`,
    [since]
  );
}

export function formatCommentsForSpeech(comments: BlogComment[]): string {
  if (comments.length === 0) return 'No hay comentarios nuevos en el blog.';

  const byPost = new Map<string, BlogComment[]>();
  for (const c of comments) {
    const key = c.post_title;
    if (!byPost.has(key)) byPost.set(key, []);
    byPost.get(key)!.push(c);
  }

  const parts: string[] = [`Tiene ${comments.length} comentario${comments.length > 1 ? 's' : ''} en el blog.`];

  for (const [title, cms] of byPost.entries()) {
    const shortTitle = title.length > 50 ? title.slice(0, 47) + '...' : title;
    parts.push(`En "${shortTitle}": ${cms.map(c => `${c.alias} dice: ${c.body}`).join('. Además, ')}.`);
  }

  return parts.join(' ');
}
