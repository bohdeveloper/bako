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
  orden:            number;      // posición manual en el panel de admin
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
    orden:            { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Project = mongoose.model<IProject>('Project', ProjectSchema);

export function formatProjectForContext(p: IProject): string {
  const estadoLabel: Record<string, string> = {
    activo: 'activo', diferido: 'diferido', completado: 'completado',
    pausado: 'pausado', abandonado: 'abandonado',
  };
  let frase = `${p.nombre} es un proyecto ${p.tipo ? `de tipo ${p.tipo} ` : ''}actualmente ${estadoLabel[p.estado] || p.estado}`;
  if (p.descripcion) frase += `. ${p.descripcion}`;
  const detalles: string[] = [];
  if (p.siguiente_accion) detalles.push(`la siguiente acción es ${p.siguiente_accion}`);
  if (p.bloqueantes?.length) detalles.push(`tiene bloqueantes: ${p.bloqueantes.join(', ')}`);
  if (p.stack?.length) detalles.push(`stack: ${p.stack.join(', ')}`);
  if (p.horizonte) detalles.push(`horizonte ${p.horizonte}`);
  if (detalles.length) frase += '. ' + detalles.join('; ') + '.';
  if (p.notas?.length) frase += ' ' + p.notas.slice(0, 4).join('. ') + '.';
  return frase;
}
