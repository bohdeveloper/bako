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
  ownSchedule: boolean; // false = no tiene cron propio (se comprueba dentro de otra tarea), no editable
}

export const JOB_DEFS: JobDef[] = [
  {
    key:         'briefing',
    nombre:      'Briefing matutino',
    horario:     'L-V 05:45',
    descripcion: 'Buenos días con clima, agenda, noticias y GitHub',
    icon:        '🌅',
    ownSchedule: true,
  },
  {
    key:         'alertas',
    nombre:      'Alertas inteligentes',
    horario:     'L-V 08:30',
    descripcion: 'Repos sin commits, PRs parados, reuniones tempranas',
    icon:        '🔔',
    ownSchedule: true,
  },
  {
    key:         'pr_review',
    nombre:      'PR Review automático',
    horario:     'L-V 08:30',
    descripcion: 'Revisión de pull requests activos como senior dev',
    icon:        '🔀',
    ownSchedule: true,
  },
  {
    key:         'perfil',
    nombre:      'Revisión de perfil',
    horario:     'Lunes 09:00',
    descripcion: 'Avisa si algún campo del perfil lleva 90+ días sin actualizarse',
    icon:        '👤',
    ownSchedule: true,
  },
  {
    key:         'techradar',
    nombre:      'Tech Radar semanal',
    horario:     'Lunes 09:30',
    descripcion: 'Top 5 novedades tech relevantes para tu stack',
    icon:        '🛰',
    ownSchedule: true,
  },
  {
    key:         'resumen_semanal',
    nombre:      'Resumen semanal',
    horario:     'Viernes 18:00',
    descripcion: 'Resumen de la semana: repos, tareas, próximos eventos',
    icon:        '📊',
    ownSchedule: true,
  },
  {
    key:         'notion_sync',
    nombre:      'Sincronización plan → Notion',
    horario:     'Cada 6h',
    descripcion: 'Revisa plan.md en GitHub y marca en Notion las tareas de BAKO ya completadas',
    icon:        '🔁',
    ownSchedule: true,
  },
  {
    key:         'notion_sync_aviso',
    nombre:      'Aviso de sincronización',
    horario:     'Junto a notion_sync',
    descripcion: 'Aviso (Telegram, push y panel) cuando se marcan tareas — la sincronización sigue activa aunque se pause este aviso',
    icon:        '💬',
    ownSchedule: false, // se comprueba dentro de runNotionSyncJob, no tiene cron propio
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
