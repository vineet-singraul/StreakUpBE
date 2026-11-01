import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema(
  {
    endpoint: { type: String, required: true },
    expirationTime: { type: Number, default: null },
    keys: {
      p256dh: String,
      auth: String,
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true },
    avatar: String,
    language: { type: String, enum: ['en', 'hi', 'hinglish'], default: 'hinglish' },
    emailReminders: { type: Boolean, default: true },
    pushReminders: { type: Boolean, default: true },
    pushSubscriptions: { type: [pushSubscriptionSchema], default: [] },
    lastLoginAt: Date,
    lastLocation: {
      latitude: Number,
      longitude: Number,
      accuracy: Number, // meters
      capturedAt: Date,
    },
    blocked: { type: Boolean, default: false },
    blockedAt: Date,
  },
  { timestamps: true },
);

// ADMIN_EMAILS is a comma-separated list. A function, not a constant: imports run before
// dotenv.config() in server.js
const DEFAULT_ADMINS = 'bigbasketnex@gmail.com,singhvisal709@gmail.com';
export const adminEmails = () =>
  (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = (email) => adminEmails().includes(String(email || '').toLowerCase());

userSchema.methods.toPublic = function toPublic() {
  return {
    isAdmin: isAdminEmail(this.email),
    id: this._id,
    email: this.email,
    name: this.name,
    avatar: this.avatar,
    language: this.language || 'hinglish',
    emailReminders: this.emailReminders,
    pushReminders: this.pushReminders,
    pushEnabled: this.pushSubscriptions.length > 0,
    lastLocation: this.lastLocation?.latitude != null ? this.lastLocation : null,
  };
};

export default mongoose.model('User', userSchema);
