import mongoose, { Document, Schema } from 'mongoose';

export interface IAutoConfig extends Document {
  key:         string;
  enabled:     boolean;
  value?:      string;   // JSON config opcional (ej. lista de feeds de noticias)
  updatedAt:   Date;
}

const AutoConfigSchema = new Schema<IAutoConfig>(
  {
    key:     { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    value:   { type: String },
  },
  { timestamps: true }
);

export const AutoConfig = mongoose.model<IAutoConfig>('AutoConfig', AutoConfigSchema);

// Definición de todos los mensajes automáticos de BAKO
export interface JobDef {
  key:         string;
  nombre:      string;
  horario:     string;
  descripcion: string;
  icon:        string;
}

export const JOB_DEFS: JobDef[] = [
  {
    key:         'briefing',
    nombre:      'Briefing matutino',
    horario:     'L-V 05:45',
    descripcion: 'Buenos días con clima, agenda, noticias y GitHub',
    icon:        '🌅',
  },
  {
    key:         'alertas',
    nombre:      'Alertas inteligentes',
    horario:     'L-V 08:30',
    descripcion: 'Repos sin commits, PRs parados, reuniones tempranas',
    icon:        '🔔',
  },
  {
    key:         'pr_review',
    nombre:      'PR Review automático',
    horario:     'L-V 08:30',
    descripcion: 'Revisión de pull requests activos como senior dev',
    icon:        '🔀',
  },
  {
    key:         'perfil',
    nombre:      'Revisión de perfil',
    horario:     'Lunes 09:00',
    descripcion: 'Avisa si algún campo del perfil lleva 90+ días sin actualizarse',
    icon:        '👤',
  },
  {
    key:         'techradar',
    nombre:      'Tech Radar semanal',
    horario:     'Lunes 09:30',
    descripcion: 'Top 5 novedades tech relevantes para tu stack',
    icon:        '🛰',
  },
  {
    key:         'resumen_semanal',
    nombre:      'Resumen semanal',
    horario:     'Viernes 18:00',
    descripcion: 'Resumen de la semana: repos, tareas, próximos eventos',
    icon:        '📊',
  },
];

export async function isJobEnabled(key: string): Promise<boolean> {
  const cfg = await AutoConfig.findOne({ key });
  return cfg ? cfg.enabled : true; // por defecto activo
}

export async function toggleJob(key: string): Promise<boolean> {
  const cfg = await AutoConfig.findOne({ key });
  const newState = cfg ? !cfg.enabled : false; // si no existe → desactivar
  await AutoConfig.findOneAndUpdate(
    { key },
    { enabled: newState },
    { upsert: true, new: true }
  );
  return newState;
}

export async function setJobEnabled(key: string, enabled: boolean): Promise<void> {
  await AutoConfig.findOneAndUpdate({ key }, { enabled }, { upsert: true });
}
