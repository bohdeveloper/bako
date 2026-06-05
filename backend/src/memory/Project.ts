import mongoose, { Document, Schema } from 'mongoose';

export type ProjectState = 'activo' | 'diferido' | 'completado' | 'pausado' | 'abandonado';
export type ProjectPriority = 'alta' | 'media' | 'baja';

export interface IProject extends Document {
  nombre:           string;
  slug:             string;       // identificador corto: "bako", "diamadmin"
  tipo:             string;       // "SaaS propio", "portfolio", "hobby", "videojuego"…
  estado:           ProjectState;
  prioridad:        ProjectPriority;
  descripcion:      string;
  siguiente_accion: string;
  bloqueantes:      string[];
  decisiones:       string[];     // decisiones clave ya tomadas
  stack:            string[];     // tecnologías
  urls:             string[];
  horizonte:        string;       // "2026", "3-5 años", "post-Galicia"
  notas:            string[];
  activo:           boolean;
  createdAt:        Date;
  updatedAt:        Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    nombre:           { type: String, required: true, trim: true },
    slug:             { type: String, default: '', lowercase: true, trim: true },
    tipo:             { type: String, default: '' },
    estado:           { type: String, enum: ['activo','diferido','completado','pausado','abandonado'], default: 'activo' },
    prioridad:        { type: String, enum: ['alta','media','baja'], default: 'media' },
    descripcion:      { type: String, default: '' },
    siguiente_accion: { type: String, default: '' },
    bloqueantes:      [String],
    decisiones:       [String],
    stack:            [String],
    urls:             [String],
    horizonte:        { type: String, default: '' },
    notas:            [String],
    activo:           { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Project = mongoose.model<IProject>('Project', ProjectSchema);

export function formatProjectForContext(p: IProject): string {
  const parts: string[] = [`${p.nombre} (${p.estado})`];
  if (p.tipo)             parts.push(p.tipo);
  if (p.descripcion)      parts.push(p.descripcion);
  if (p.siguiente_accion) parts.push(`siguiente: ${p.siguiente_accion}`);
  if (p.bloqueantes?.length) parts.push(`bloqueantes: ${p.bloqueantes.join(', ')}`);
  if (p.stack?.length)    parts.push(`stack: ${p.stack.join(', ')}`);
  if (p.horizonte)        parts.push(`horizonte: ${p.horizonte}`);
  if (p.notas?.length)    parts.push(p.notas.join('. '));
  return parts.join(' — ');
}
