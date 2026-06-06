import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
  text:       string;
  voiceText?: string;
  source:     string;
  createdAt:  Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    text:      { type: String, required: true },
    voiceText: { type: String },
    source:    { type: String, default: 'system' },
  },
  { timestamps: true }
);

// TTL: cada cliente usa ?since= para filtrar; las notificaciones expiran solas en 24h
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
