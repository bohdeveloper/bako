import mongoose, { Document, Schema } from 'mongoose';

export type MemoryType       = 'fact' | 'preference' | 'project_update' | 'decision' | 'feeling';
export type MemoryImportance = 'high' | 'medium' | 'low';
export type MemorySource     = 'manual' | 'extracted';

export interface IMemory extends Document {
  content:    string;
  type:       MemoryType;
  importance: MemoryImportance;
  source:     MemorySource;
  tags:       string[];
  createdAt:  Date;
  updatedAt:  Date;
}

const MemorySchema = new Schema<IMemory>(
  {
    content:    { type: String, required: true },
    type:       { type: String, enum: ['fact', 'preference', 'project_update', 'decision', 'feeling'], default: 'fact' },
    importance: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    source:     { type: String, enum: ['manual', 'extracted'], default: 'extracted' },
    tags:       [String],
  },
  { timestamps: true }
);

export const Memory = mongoose.model<IMemory>('Memory', MemorySchema);
