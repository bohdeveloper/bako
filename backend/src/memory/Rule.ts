import mongoose, { Document, Schema } from 'mongoose';

export interface IRule extends Document {
  description:    string;
  active:         boolean;
  lastTriggered:  Date | null;
  createdAt:      Date;
}

const RuleSchema = new Schema<IRule>(
  {
    description:   { type: String, required: true },
    active:        { type: Boolean, default: true },
    lastTriggered: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Rule = mongoose.model<IRule>('Rule', RuleSchema);
