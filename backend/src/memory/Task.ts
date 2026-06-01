import mongoose, { Document, Schema } from 'mongoose';

export type TaskStatus = 'pending' | 'done' | 'error';

export interface ITask extends Document {
  prompt: string;
  respuesta?: string;
  status: TaskStatus;
  errorMsg?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    prompt:    { type: String, required: true },
    respuesta: { type: String },
    status:    { type: String, enum: ['pending', 'done', 'error'], default: 'pending' },
    errorMsg:  { type: String },
  },
  {
    timestamps: true, // genera createdAt y updatedAt automáticamente
  }
);

export const Task = mongoose.model<ITask>('Task', TaskSchema);
