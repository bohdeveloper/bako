/**
 * Capa de acceso a Notion — bases "Tareas" y "Proyectos" de Centro de Mando.
 *
 * El esquema de Centro de Mando difiere del antiguo (página BAKO): el título de
 * las tareas es "Tarea" y no "Nombre", los estados y prioridades tienen otros
 * valores, y "Proyecto" es una relación en vez de texto libre. Los nombres de
 * propiedad y los estados viven en las constantes de abajo para que un cambio en
 * Notion se arregle en un único sitio.
 */

import axios from 'axios';

const api = axios.create({
  baseURL: 'https://api.notion.com/v1',
  headers: {
    Authorization:    `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json',
  },
});

// ─── Esquema de Centro de Mando ───────────────────────────────────────────────

const TAREA = {
  titulo:    'Tarea',
  estado:    'Estado',
  prioridad: 'Prioridad',
  proyecto:  'Proyecto',      // relación → base Proyectos
  fecha:     'Fecha objetivo',
  notas:     'Notas',
} as const;

const PROYECTO = {
  titulo:      'Proyecto',
  estado:      'Estado',
  prioridad:   'Prioridad',
  siguiente:   'Siguiente paso',
  descripcion: 'Descripción',
  stack:       'Stack',
  web:         'Web',
  repositorio: 'Repositorio',
  area:        'Área',
} as const;

// Estados que cuentan como "ya no pendiente"
const TAREA_HECHA     = 'Hecho';
const TAREA_PENDIENTE = 'Por hacer';
const TAREA_EN_CURSO  = 'En curso';

// Proyectos que ya no están en juego
const PROYECTO_CERRADO = /terminado|archivado/i;

const PRIORIDAD_CRITICA     = 'P1 · Crítico';
const PRIORIDAD_POR_DEFECTO = 'P2 · Importante';
const PRIORIDAD_APLAZADA    = 'P3 · Aplazado';

export type EstadoTarea = 'Por hacer' | 'En curso' | 'Bloqueado' | 'Hecho';

/**
 * Centro de Mando usa prioridades P1..P4, pero en voz y por escrito el señor
 * dice "alta", "media" o "baja". Se traduce aquí para que los prompts sigan
 * hablando en lenguaje natural y Notion reciba siempre un valor válido.
 */
export function normalizePrioridad(raw?: string): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return PRIORIDAD_POR_DEFECTO;
  if (s.startsWith('p1') || s.includes('crítico') || s.includes('critico') || s.includes('alta')) return PRIORIDAD_CRITICA;
  if (s.startsWith('p2') || s.includes('importante') || s.includes('media')) return PRIORIDAD_POR_DEFECTO;
  if (s.startsWith('p3') || s.includes('aplazado') || s.includes('baja')) return PRIORIDAD_APLAZADA;
  if (s.startsWith('p4') || s.includes('archivado')) return 'P4 · Archivado';
  return PRIORIDAD_POR_DEFECTO;
}

export function esPrioridadCritica(prioridad: string): boolean {
  return normalizePrioridad(prioridad) === PRIORIDAD_CRITICA;
}

export function iconoPrioridad(prioridad: string): string {
  const p = normalizePrioridad(prioridad);
  if (p === PRIORIDAD_CRITICA)     return '🔴';
  if (p === PRIORIDAD_POR_DEFECTO) return '🟡';
  return '⚪';
}

/** Traduce lo que diga el señor ("completada", "en progreso") al estado real. */
export function normalizeEstadoTarea(raw?: string): EstadoTarea {
  const s = (raw ?? '').trim().toLowerCase();
  if (s.includes('hecho') || s.includes('completad') || s.includes('terminad') || s.includes('done') || s.includes('list')) return 'Hecho';
  if (s.includes('curso') || s.includes('progreso') || s.includes('empezad')) return 'En curso';
  if (s.includes('bloque')) return 'Bloqueado';
  return 'Por hacer';
}

export interface NotionTask {
  id: string;
  nombre: string;
  estado: string;
  prioridad: string;
  proyecto: string;
  fechaLimite: string | null;
}

export interface NotionProject {
  id: string;
  nombre: string;
  estado: string;
  prioridad: string;
  area: string;
  descripcion: string;
  siguiente_accion: string;
  stack: string[];
  urls: string[];
}

// ─── Extractores ──────────────────────────────────────────────────────────────

function extractText(prop: any): string {
  return (prop?.rich_text ?? []).map((t: any) => t.plain_text).join('');
}

function extractTitle(prop: any): string {
  return (prop?.title ?? []).map((t: any) => t.plain_text).join('');
}

function extractSelect(prop: any): string {
  return prop?.select?.name ?? '';
}

function extractDate(prop: any): string | null {
  return prop?.date?.start ?? null;
}

function extractUrl(prop: any): string {
  return prop?.url ?? '';
}

// Stack se guarda como texto libre separado por comas ("Angular, Spring Boot")
function splitList(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function mapProject(p: any): NotionProject {
  const urls = [extractUrl(p.properties[PROYECTO.web]), extractUrl(p.properties[PROYECTO.repositorio])]
    .filter(Boolean);

  return {
    id:               p.id,
    nombre:           extractTitle(p.properties[PROYECTO.titulo]),
    estado:           extractSelect(p.properties[PROYECTO.estado]),
    prioridad:        extractSelect(p.properties[PROYECTO.prioridad]),
    area:             extractSelect(p.properties[PROYECTO.area]),
    descripcion:      extractText(p.properties[PROYECTO.descripcion]),
    siguiente_accion: extractText(p.properties[PROYECTO.siguiente]),
    stack:            splitList(extractText(p.properties[PROYECTO.stack])),
    urls,
  };
}

function projectsDbId(): string {
  const id = process.env.NOTION_PROJECTS_DB_ID;
  if (!id) throw new Error('NOTION_PROJECTS_DB_ID no definido en .env');
  return id;
}

function tasksDbId(): string {
  const id = process.env.NOTION_TASKS_DB_ID;
  if (!id) throw new Error('NOTION_TASKS_DB_ID no definido en .env');
  return id;
}

// Notion pagina de 100 en 100; con 60 tareas y 15 proyectos aún sobra, pero sin
// esto la lista se corta en silencio en cuanto crezcan.
async function queryAll(dbId: string, body: Record<string, unknown> = {}): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;

  do {
    const { data } = await api.post(`/databases/${dbId}/query`, {
      ...body,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

// ─── Proyectos ────────────────────────────────────────────────────────────────

// Todos los proyectos sin filtrar — para el espejo en Mongo, que debe reflejar
// también los terminados y archivados.
export async function getAllNotionProjects(): Promise<NotionProject[]> {
  const results = await queryAll(projectsDbId(), {
    sorts: [{ property: PROYECTO.prioridad, direction: 'ascending' }],
  });
  return results.map(mapProject);
}

// Solo los proyectos en juego — los que interesan en el briefing y el prompt.
export async function getNotionProjects(): Promise<NotionProject[]> {
  const todos = await getAllNotionProjects();
  return todos.filter(p => !PROYECTO_CERRADO.test(p.estado));
}

// Mismo formato en prosa que formatProjectForContext, para que el prompt no
// cambie de estilo según venga de Notion o del espejo en Mongo.
export function formatNotionProjectForContext(p: NotionProject): string {
  let frase = `${p.nombre} es un proyecto actualmente ${(p.estado || 'en curso').toLowerCase()}`;
  if (p.area) frase += ` (área: ${p.area})`;
  if (p.descripcion) frase += `. ${p.descripcion}`;
  const detalles: string[] = [];
  if (p.siguiente_accion) detalles.push(`el siguiente paso es ${p.siguiente_accion}`);
  if (p.prioridad)        detalles.push(`prioridad ${p.prioridad}`);
  if (p.stack.length)     detalles.push(`stack: ${p.stack.join(', ')}`);
  if (p.urls.length)      detalles.push(`enlaces: ${p.urls.join(', ')}`);
  if (detalles.length) frase += '. ' + detalles.join('; ') + '.';
  return frase;
}

export async function updateNotionProjectSiguienteAccion(
  nombreProyecto: string,
  siguienteAccion: string
): Promise<boolean> {
  const results = await queryAll(projectsDbId());

  const lower = nombreProyecto.toLowerCase();
  const page = results.find((p: any) => {
    const n = extractTitle(p.properties[PROYECTO.titulo]).toLowerCase();
    return n && (n === lower || n.includes(lower) || lower.includes(n));
  });

  if (!page) return false;

  await api.patch(`/pages/${page.id}`, {
    properties: {
      [PROYECTO.siguiente]: { rich_text: [{ text: { content: siguienteAccion } }] },
    },
  });

  return true;
}

export async function createNotionProject(
  nombre: string,
  opciones: { descripcion?: string; estado?: string } = {}
): Promise<string> {
  const { data } = await api.post('/pages', {
    parent: { database_id: projectsDbId() },
    properties: {
      [PROYECTO.titulo]:      { title:     [{ text: { content: nombre } }] },
      [PROYECTO.estado]:      { select:    { name: opciones.estado ?? 'Sin empezar' } },
      [PROYECTO.descripcion]: { rich_text: [{ text: { content: opciones.descripcion ?? '' } }] },
    },
  });

  return data.id as string;
}

// ─── Tareas ───────────────────────────────────────────────────────────────────

// "Proyecto" es una relación: sus páginas solo traen el id, así que hace falta
// el mapa id → nombre para poder nombrarlo en el prompt.
async function projectNamesById(): Promise<Map<string, string>> {
  const results = await queryAll(projectsDbId());
  return new Map(results.map((p: any) => [p.id, extractTitle(p.properties[PROYECTO.titulo])]));
}

function mapTask(p: any, projectNames: Map<string, string>): NotionTask {
  const relacion = p.properties[TAREA.proyecto]?.relation ?? [];
  const proyecto = relacion
    .map((r: any) => projectNames.get(r.id) ?? '')
    .filter(Boolean)
    .join(', ');

  return {
    id:          p.id,
    nombre:      extractTitle(p.properties[TAREA.titulo]),
    estado:      extractSelect(p.properties[TAREA.estado]),
    prioridad:   extractSelect(p.properties[TAREA.prioridad]),
    proyecto,
    fechaLimite: extractDate(p.properties[TAREA.fecha]),
  };
}

export async function getNotionTasks(): Promise<NotionTask[]> {
  const [results, projectNames] = await Promise.all([
    queryAll(tasksDbId(), {
      filter: { property: TAREA.estado, select: { does_not_equal: TAREA_HECHA } },
      sorts: [
        { property: TAREA.prioridad, direction: 'ascending' },
        { property: TAREA.fecha,     direction: 'ascending' },
      ],
    }),
    projectNamesById(),
  ]);

  return results.map(p => mapTask(p, projectNames));
}

export async function updateNotionTaskStatus(taskId: string, estado: EstadoTarea): Promise<void> {
  await api.patch(`/pages/${taskId}`, {
    properties: { [TAREA.estado]: { select: { name: estado } } },
  });
}

export async function findNotionTaskByName(nombre: string): Promise<NotionTask | null> {
  const [results, projectNames] = await Promise.all([
    queryAll(tasksDbId(), {
      filter: { property: TAREA.estado, select: { does_not_equal: TAREA_HECHA } },
    }),
    projectNamesById(),
  ]);

  const tasks = results.map(p => mapTask(p, projectNames));
  const lower = nombre.toLowerCase();

  return (
    tasks.find(t => t.nombre.toLowerCase() === lower) ??
    tasks.find(t => t.nombre.toLowerCase().includes(lower) || lower.includes(t.nombre.toLowerCase())) ??
    null
  );
}

export async function createNotionTask(
  nombre: string,
  opciones: { prioridad?: string; proyecto?: string; fechaLimite?: string } = {}
): Promise<NotionTask> {
  const prioridad = normalizePrioridad(opciones.prioridad);

  const properties: any = {
    [TAREA.titulo]:    { title:  [{ text: { content: nombre } }] },
    [TAREA.estado]:    { select: { name: TAREA_PENDIENTE } },
    [TAREA.prioridad]: { select: { name: prioridad } },
  };

  // El proyecto llega por nombre pero se guarda como relación: hay que resolverlo
  // a un id. Si no existe ninguno que encaje, la tarea se crea sin proyecto.
  let proyectoResuelto = '';
  if (opciones.proyecto) {
    const names = await projectNamesById();
    const lower = opciones.proyecto.toLowerCase();
    for (const [id, nombreProyecto] of names) {
      const n = nombreProyecto.toLowerCase();
      if (!n) continue;
      if (n === lower || n.includes(lower) || lower.includes(n)) {
        properties[TAREA.proyecto] = { relation: [{ id }] };
        proyectoResuelto = nombreProyecto;
        break;
      }
    }
  }

  if (opciones.fechaLimite) {
    properties[TAREA.fecha] = { date: { start: opciones.fechaLimite } };
  }

  const { data } = await api.post('/pages', {
    parent: { database_id: tasksDbId() },
    properties,
  });

  return {
    id:          data.id,
    nombre,
    estado:      TAREA_PENDIENTE,
    prioridad,
    proyecto:    proyectoResuelto,
    fechaLimite: opciones.fechaLimite ?? null,
  };
}

export { TAREA_HECHA, TAREA_PENDIENTE, TAREA_EN_CURSO, PRIORIDAD_POR_DEFECTO };
