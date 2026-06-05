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

/** Convierte un registro Person en prosa natural para el system prompt */
export function formatPersonForContext(p: IPerson): string {
  const rel: Record<string, string> = {
    pareja: 'la pareja de Borja', familiar: 'familiar de Borja',
    amigo: 'amigo de Borja', compañero: 'compañero de Borja',
    conocido: 'conocido de Borja', otro: 'persona conocida por Borja',
  };
  const intro = p.descripcion
    ? `${p.nombre} es ${p.descripcion}`
    : `${p.nombre} es ${rel[p.relacion] || p.relacion}`;

  const detalles: string[] = [];
  if (p.ubicacion) detalles.push(`vive en ${p.ubicacion}`);
  if (p.trabajo)   detalles.push(`trabaja como ${p.trabajo}`);
  if (p.cumpleaños) detalles.push(`cumple el ${p.cumpleaños}`);
  if (p.conexiones?.length) detalles.push(`está relacionado con ${p.conexiones.join(' y ')}`);

  const frase = detalles.length ? `${intro}. ${detalles.join(', ')}.` : `${intro}.`;
  const notas = p.notas?.length ? ' ' + p.notas.join('. ') + '.' : '';
  return frase + notas;
}
