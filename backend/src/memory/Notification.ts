import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
  text:       string;
  voiceText?: string;
  read:       boolean;
  source:     string;
  createdAt:  Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    text:      { type: String, required: true },
    voiceText: { type: String },
    read:      { type: Boolean, default: false },
    source:    { type: String, default: 'system' },
  },
  { timestamps: true }
);

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
