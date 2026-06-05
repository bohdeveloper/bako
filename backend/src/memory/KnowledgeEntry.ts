import mongoose, { Document, Schema } from 'mongoose';

export type KnowledgeCategory =
  | 'salud'      // digestión, sueño, suplementos, dieta, psicólogo
  | 'valores'    // filosofía, estoicismo, principios
  | 'caracter'   // fortalezas, debilidades, personalidad
  | 'finanzas'   // ahorros, metas, situación económica
  | 'historia'   // origen, momentos clave, pasado
  | 'rutina'     // rutina diaria, hábitos, entrenamiento
  | 'objetivos'  // metas vitales, planes a largo plazo
  | 'legal'      // proceso judicial, LAE
  | 'hobbies'    // intereses, aficiones, ocio
  | 'otro';

export interface IKnowledgeEntry extends Document {
  categoria:   KnowledgeCategory;
  clave:       string;      // identificador breve: "filosofia_base", "ahorros_actuales"
  valor:       string;      // contenido principal
  detalles:    string[];    // puntos adicionales
  importancia: 'alta' | 'media' | 'baja';
  fuente:      'manual' | 'extracted';
  activo:      boolean;
  createdAt:   Date;
  updatedAt:   Date;
}

const KnowledgeSchema = new Schema<IKnowledgeEntry>(
  {
    categoria:   { type: String, enum: ['salud','valores','caracter','finanzas','historia','rutina','objetivos','legal','hobbies','otro'], required: true },
    clave:       { type: String, required: true, trim: true },
    valor:       { type: String, required: true },
    detalles:    [String],
    importancia: { type: String, enum: ['alta','media','baja'], default: 'media' },
    fuente:      { type: String, enum: ['manual','extracted'], default: 'manual' },
    activo:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const KnowledgeEntry = mongoose.model<IKnowledgeEntry>('KnowledgeEntry', KnowledgeSchema);

export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  salud:     '🩺 Salud',
  valores:   '⚖️ Valores',
  caracter:  '🧠 Carácter',
  finanzas:  '💰 Finanzas',
  historia:  '📖 Historia',
  rutina:    '🔄 Rutina',
  objetivos: '🎯 Objetivos',
  legal:     '⚖️ Legal',
  hobbies:   '🎮 Hobbies',
  otro:      '📌 Otro',
};

/** Formatea todas las entradas agrupadas por categoría para el system prompt */
export function formatKnowledgeForContext(entries: IKnowledgeEntry[]): string {
  if (!entries.length) return '';
  const byCategory: Record<string, string[]> = {};
  for (const e of entries) {
    if (!byCategory[e.categoria]) byCategory[e.categoria] = [];
    const detail = e.detalles?.length ? ` (${e.detalles.join('; ')})` : '';
    byCategory[e.categoria].push(`${e.clave}: ${e.valor}${detail}`);
  }
  return Object.entries(byCategory)
    .map(([cat, items]) => `[${cat}] ${items.join(' · ')}`)
    .join('\n');
}
