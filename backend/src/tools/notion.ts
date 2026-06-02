import axios from 'axios';

const api = axios.create({
  baseURL: 'https://api.notion.com/v1',
  headers: {
    Authorization:    `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json',
  },
});

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
  descripcion: string;
}

function extractText(prop: any): string {
  return prop?.rich_text?.[0]?.plain_text ?? '';
}

function extractTitle(prop: any): string {
  return prop?.title?.[0]?.plain_text ?? '';
}

function extractSelect(prop: any): string {
  return prop?.select?.name ?? '';
}

function extractDate(prop: any): string | null {
  return prop?.date?.start ?? null;
}

export async function getNotionTasks(): Promise<NotionTask[]> {
  const dbId = process.env.NOTION_TASKS_DB_ID;
  if (!dbId) throw new Error('NOTION_TASKS_DB_ID no definido en .env');

  const { data } = await api.post(`/databases/${dbId}/query`, {
    filter: {
      property: 'Estado',
      select: { does_not_equal: 'Completada' },
    },
    sorts: [
      { property: 'Prioridad', direction: 'ascending' },
      { property: 'Fecha límite', direction: 'ascending' },
    ],
  });

  return data.results.map((p: any) => ({
    id:          p.id,
    nombre:      extractTitle(p.properties.Nombre),
    estado:      extractSelect(p.properties.Estado),
    prioridad:   extractSelect(p.properties.Prioridad),
    proyecto:    extractText(p.properties.Proyecto),
    fechaLimite: extractDate(p.properties['Fecha límite']),
  }));
}

export async function getNotionProjects(): Promise<NotionProject[]> {
  const dbId = process.env.NOTION_PROJECTS_DB_ID;
  if (!dbId) throw new Error('NOTION_PROJECTS_DB_ID no definido en .env');

  const { data } = await api.post(`/databases/${dbId}/query`, {
    filter: {
      property: 'Estado',
      select: { equals: 'Activo' },
    },
  });

  return data.results.map((p: any) => ({
    id:          p.id,
    nombre:      extractTitle(p.properties.Nombre),
    estado:      extractSelect(p.properties.Estado),
    descripcion: extractText(p.properties.Descripción),
  }));
}

export async function updateNotionTaskStatus(
  taskId: string,
  estado: 'Pendiente' | 'En progreso' | 'Completada'
): Promise<void> {
  await api.patch(`/pages/${taskId}`, {
    properties: { Estado: { select: { name: estado } } },
  });
}

export async function findNotionTaskByName(nombre: string): Promise<NotionTask | null> {
  const dbId = process.env.NOTION_TASKS_DB_ID;
  if (!dbId) throw new Error('NOTION_TASKS_DB_ID no definido en .env');

  const { data } = await api.post(`/databases/${dbId}/query`, {
    filter: { property: 'Estado', select: { does_not_equal: 'Completada' } },
  });

  const tasks: NotionTask[] = data.results.map((p: any) => ({
    id:          p.id,
    nombre:      extractTitle(p.properties.Nombre),
    estado:      extractSelect(p.properties.Estado),
    prioridad:   extractSelect(p.properties.Prioridad),
    proyecto:    extractText(p.properties.Proyecto),
    fechaLimite: extractDate(p.properties['Fecha límite']),
  }));

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
  const dbId = process.env.NOTION_TASKS_DB_ID;
  if (!dbId) throw new Error('NOTION_TASKS_DB_ID no definido en .env');

  const properties: any = {
    Nombre:    { title:  [{ text: { content: nombre } }] },
    Estado:    { select: { name: 'Pendiente' } },
    Prioridad: { select: { name: opciones.prioridad ?? 'Media' } },
  };

  if (opciones.proyecto) {
    properties.Proyecto = { rich_text: [{ text: { content: opciones.proyecto } }] };
  }
  if (opciones.fechaLimite) {
    properties['Fecha límite'] = { date: { start: opciones.fechaLimite } };
  }

  const { data } = await api.post('/pages', {
    parent: { database_id: dbId },
    properties,
  });

  return {
    id:          data.id,
    nombre,
    estado:      'Pendiente',
    prioridad:   opciones.prioridad ?? 'Media',
    proyecto:    opciones.proyecto ?? '',
    fechaLimite: opciones.fechaLimite ?? null,
  };
}
