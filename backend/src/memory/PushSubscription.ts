import mongoose, { Document, Schema } from 'mongoose';

export interface IPushSubscription extends Document {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
  },
  { timestamps: true }
);

export const PushSubscription = mongoose.model<IPushSubscription>('PushSubscription', PushSubscriptionSchema);
