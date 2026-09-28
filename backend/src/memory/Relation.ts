import mongoose, { Document, Schema } from 'mongoose';

/**
 * B4 del plan — relaciones tipadas entre las piezas del cerebro (Persona ↔
 * Proyecto ↔ Conocimiento), en vez del array de nombres sueltos en
 * `Person.conexiones` (que sigue existiendo para la prosa simple del prompt,
 * esto es el grafo real que permite consultar y deducir).
 *
 * `dicha` distingue lo que el señor dijo explícitamente (confianza 1, fija)
 * de lo que BAKO dedujo por su cuenta (`confianza` 0-1, con `explicacion` de
 * por qué) — para no presentar nunca una deducción como un hecho (B4.3).
 */
export type RelationEntityType = 'persona' | 'proyecto' | 'conocimiento';

export interface IRelation extends Document {
  origenTipo:    RelationEntityType;
  origenId:      mongoose.Types.ObjectId;
  origenNombre:  string;   // cache legible: evita un populate en cada lectura
  destinoTipo:   RelationEntityType;
  destinoId:     mongoose.Types.ObjectId;
  destinoNombre: string;
  relacion:      string;   // etiqueta libre y breve: "trabaja en", "es pareja de"...
  dicha:         boolean;  // true = lo dijo el señor; false = deducción de BAKO
  confianza:     number;   // 1 si dicha=true; 0-1 si es deducción
  explicacion:   string;   // por qué se dedujo (o la frase de origen si fue dicha)
  fuente:        'manual' | 'conversacion';
  activo:        boolean;
  createdAt:     Date;
  updatedAt:     Date;     // también sirve de "última confirmación" para la caducidad (B4.5)
}

const RelationSchema = new Schema<IRelation>(
  {
    origenTipo:    { type: String, enum: ['persona', 'proyecto', 'conocimiento'], required: true },
    origenId:      { type: Schema.Types.ObjectId, required: true },
    origenNombre:  { type: String, required: true, trim: true },
    destinoTipo:   { type: String, enum: ['persona', 'proyecto', 'conocimiento'], required: true },
    destinoId:     { type: Schema.Types.ObjectId, required: true },
    destinoNombre: { type: String, required: true, trim: true },
    relacion:      { type: String, required: true, trim: true },
    dicha:         { type: Boolean, default: true },
    confianza:     { type: Number, default: 1, min: 0, max: 1 },
    explicacion:   { type: String, default: '' },
    fuente:        { type: String, enum: ['manual', 'conversacion'], default: 'conversacion' },
    activo:        { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Ambos sentidos: al consultar una entidad hay que encontrarla tanto si es
// origen como si es destino de la relación.
RelationSchema.index({ origenTipo: 1, origenId: 1, activo: 1 });
RelationSchema.index({ destinoTipo: 1, destinoId: 1, activo: 1 });

export const Relation = mongoose.model<IRelation>('Relation', RelationSchema);

export function confianzaLabel(c: number): 'alta' | 'media' | 'baja' {
  if (c >= 0.75) return 'alta';
  if (c >= 0.5) return 'media';
  return 'baja';
}
