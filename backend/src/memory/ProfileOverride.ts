import mongoose, { Document, Schema } from 'mongoose';

export interface IProfileOverride extends Document {
  key:       string;   // campo del perfil, ej: "identidad.empleador"
  label:     string;   // nombre legible, ej: "Empleador"
  value:     string;   // valor actual
  prevValue: string;   // valor anterior (historial)
  source:    'manual' | 'conversation' | 'bako_suggestion';
  createdAt: Date;
  updatedAt: Date;
}

const ProfileOverrideSchema = new Schema<IProfileOverride>(
  {
    key:       { type: String, required: true, unique: true },
    label:     { type: String, required: true },
    value:     { type: String, required: true },
    prevValue: { type: String, default: '' },
    source:    { type: String, enum: ['manual', 'conversation', 'bako_suggestion'], default: 'manual' },
  },
  { timestamps: true }
);

export const ProfileOverride = mongoose.model<IProfileOverride>('ProfileOverride', ProfileOverrideSchema);
