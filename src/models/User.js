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
    emailReminders: { type: Boolean, default: true },
    pushReminders: { type: Boolean, default: true },
    pushSubscriptions: { type: [pushSubscriptionSchema], default: [] },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    email: this.email,
    name: this.name,
    avatar: this.avatar,
    emailReminders: this.emailReminders,
    pushReminders: this.pushReminders,
    pushEnabled: this.pushSubscriptions.length > 0,
  };
};

export default mongoose.model('User', userSchema);
