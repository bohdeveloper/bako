import mongoose, { Document, Schema } from 'mongoose';

// Historia de actividad: un documento por día (Europe/Madrid). Guarda solo conteos, nunca el
// contenido de los commits — el registro de patrones no necesita más para detectar rachas ni energía.
export interface IActividadDiaria extends Document {
  fecha:    string;                                  // YYYY-MM-DD
  commits:  { repo: string; n: number }[];
  tareas?:  { proyecto: string; abiertas: number }[]; // solo en el registro del día en curso
  tareasHechas?: number;                               // tareas de Notion cerradas ese día
}

const ActividadDiariaSchema = new Schema<IActividadDiaria>(
  {
    fecha:   { type: String, required: true, unique: true },
    commits: {
      type: [{ _id: false, repo: String, n: Number }],
      default: [],
    },
    tareas: {
      type: [{ _id: false, proyecto: String, abiertas: Number }],
      default: undefined, // sin snapshot no debe aparecer como lista vacía
    },
    tareasHechas: { type: Number, default: undefined },
  }
);

export const ActividadDiaria = mongoose.model<IActividadDiaria>('ActividadDiaria', ActividadDiariaSchema);
