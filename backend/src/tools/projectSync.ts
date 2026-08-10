/**
 * Espejo Notion → MongoDB de los proyectos.
 *
 * Notion es la fuente de verdad. Cada lectura correcta refresca la colección
 * Project, que queda como copia local para responder cuando Notion no está
 * disponible. El espejo solo añade y actualiza: nunca borra un proyecto de
 * Mongo aunque desaparezca de Notion.
 */

import { Project, ProjectState, ProjectPriority, IProject } from '../memory/Project';
import { NotionProject } from './notion';

// Estados de Centro de Mando → enum de la colección Project en Mongo
const ESTADO_MAP: Record<string, ProjectState> = {
  'sin empezar': 'diferido',
  'en curso':    'activo',
  'en pausa':    'pausado',
  'terminado':   'completado',
  'archivado':   'abandonado',
};

// NFD separa la tilde de la letra y el filtro final descarta todo lo que no sea
// alfanumérico ASCII, marcas de combinación incluidas: "Operación" → "operacion".
export function slugify(nombre: string): string {
  return nombre
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function mapEstado(estado: string): ProjectState {
  return ESTADO_MAP[estado.toLowerCase().trim()] ?? 'activo';
}

// P1..P4 de Notion → enum alta/media/baja de Mongo
function mapPrioridad(prioridad: string): ProjectPriority {
  const p = prioridad.toLowerCase();
  if (p.startsWith('p1')) return 'alta';
  if (p.startsWith('p2')) return 'media';
  return 'baja';
}

// Notion manda en lo que Notion conoce. Los campos que solo existen en Mongo
// (notas, decisiones, bloqueantes, orden, tipo, horizonte) se respetan, y los
// vacíos de Notion no pisan datos ya guardados.
function applyNotionFields(doc: IProject, np: NotionProject): void {
  doc.nombre = np.nombre;
  doc.estado = mapEstado(np.estado);
  if (np.prioridad)        doc.prioridad        = mapPrioridad(np.prioridad);
  if (np.area)             doc.tipo             = np.area;
  if (np.descripcion)      doc.descripcion      = np.descripcion;
  if (np.siguiente_accion) doc.siguiente_accion = np.siguiente_accion;
  if (np.stack.length)     doc.stack            = np.stack;
  if (np.urls.length)      doc.urls             = np.urls;
}

/**
 * El emparejado va en dos fases porque el slug de Notion no siempre coincide con
 * el que ya hay en Mongo ("bohdeveloper.com" → "bohdeveloper"), pero una
 * coincidencia parcial ingenua fusiona proyectos hermanos: "unyona-landing"
 * contiene "unyona". Primero se resuelven las coincidencias exactas y se marcan
 * los documentos ocupados; solo después se intenta la parcial, y únicamente si
 * queda un candidato libre y sin ambigüedad.
 */
export async function syncNotionProjectsToMongo(
  projects: NotionProject[]
): Promise<{ created: number; updated: number }> {
  const validos = projects.filter(p => p.nombre.trim());
  const docs    = await Project.find();
  const claimed = new Set<string>();
  const pairs: Array<{ np: NotionProject; doc: IProject | null }> = [];

  // Fase 1 — coincidencia exacta por slug o por nombre
  const pendientes: NotionProject[] = [];
  for (const np of validos) {
    const slug = slugify(np.nombre);
    const doc  = docs.find(d => !claimed.has(String(d._id)) && (d.slug === slug || d.nombre === np.nombre));
    if (doc) {
      claimed.add(String(doc._id));
      pairs.push({ np, doc });
    } else {
      pendientes.push(np);
    }
  }

  // Fase 2 — coincidencia parcial, solo si es única entre los no ocupados
  for (const np of pendientes) {
    const slug = slugify(np.nombre);
    if (slug.length < 4) { pairs.push({ np, doc: null }); continue; }

    const candidatos = docs.filter(d => {
      if (claimed.has(String(d._id)) || d.slug.length < 4) return false;
      return slug.includes(d.slug) || d.slug.includes(slug);
    });

    if (candidatos.length === 1) {
      claimed.add(String(candidatos[0]._id));
      pairs.push({ np, doc: candidatos[0] });
    } else {
      pairs.push({ np, doc: null });
    }
  }

  let created = 0;
  let updated = 0;

  for (const { np, doc } of pairs) {
    if (doc) {
      applyNotionFields(doc, np);
      await doc.save();
      updated++;
    } else {
      await Project.create({
        nombre:           np.nombre,
        slug:             slugify(np.nombre),
        estado:           mapEstado(np.estado),
        prioridad:        mapPrioridad(np.prioridad),
        tipo:             np.area,
        descripcion:      np.descripcion,
        siguiente_accion: np.siguiente_accion,
        stack:            np.stack,
        urls:             np.urls,
      });
      created++;
    }
  }

  return { created, updated };
}
