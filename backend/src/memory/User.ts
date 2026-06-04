import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  role: 'superadmin' | 'user';
  active: boolean;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['superadmin', 'user'], default: 'user' },
  active:       { type: Boolean, default: true },
  createdAt:    { type: Date, default: Date.now },
});

export const User = mongoose.model<IUser>('User', UserSchema);
