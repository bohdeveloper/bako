import mongoose, { Document, Schema } from 'mongoose';

export type PersonRelation =
  | 'pareja' | 'familiar' | 'amigo' | 'compañero' | 'conocido' | 'otro';

export interface IPerson extends Document {
  nombre:      string;
  alias:       string[];          // variantes del nombre
  relacion:    PersonRelation;
  descripcion: string;            // una frase que define quién es
  cumpleaños:  string;            // "DD-MM" ej: "15-08"
  ubicacion:   string;
  trabajo:     string;
  notas:       string[];          // observaciones libres
  conexiones:  string[];          // nombres de otras personas relacionadas
  activo:      boolean;           // sigue siendo parte de la vida actual
  orden:       number;            // posición manual en el panel de admin
  createdAt:   Date;
  updatedAt:   Date;
}

const PersonSchema = new Schema<IPerson>(
  {
    nombre:      { type: String, required: true, trim: true },
    alias:       [String],
    relacion:    { type: String, enum: ['pareja','familiar','amigo','compañero','conocido','otro'], default: 'conocido' },
    descripcion: { type: String, default: '' },
    cumpleaños:  { type: String, default: '' },   // "DD-MM"
    ubicacion:   { type: String, default: '' },
    trabajo:     { type: String, default: '' },
    notas:       [String],
    conexiones:  [String],
    activo:      { type: Boolean, default: true },
    orden:       { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Person = mongoose.model<IPerson>('Person', PersonSchema);

/** Convierte un registro Person en texto para el system prompt */
export function formatPersonForContext(p: IPerson): string {
  const parts: string[] = [`${p.nombre} (${p.relacion})`];
  if (p.descripcion)            parts.push(p.descripcion);
  if (p.cumpleaños)             parts.push(`cumple el ${p.cumpleaños}`);
  if (p.ubicacion)              parts.push(`vive en ${p.ubicacion}`);
  if (p.trabajo)                parts.push(p.trabajo);
  if (p.conexiones?.length)     parts.push(`relacionado con: ${p.conexiones.join(', ')}`);
  if (p.notas?.length)          parts.push(p.notas.join('. '));
  return parts.join(' — ');
}
