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
  },
  { timestamps: true },
);

// A function, not a constant: imports run before dotenv.config() in server.js
export const adminEmail = () => (process.env.ADMIN_EMAIL || 'bigbasketnex@gmail.com').toLowerCase();

userSchema.methods.toPublic = function toPublic() {
  return {
    isAdmin: this.email === adminEmail(),
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
