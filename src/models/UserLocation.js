import mongoose from 'mongoose';

// Location history: one document per IP lookup or GPS fix (near-duplicates are skipped by the route)
const userLocationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['ip', 'gps'], required: true },
    latitude: Number,
    longitude: Number,
    accuracy: Number, // meters (GPS only)
    ip: String,
    country: String,
    region: String,
    city: String,
    isp: String,
    timezone: String,
    approximate: { type: Boolean, default: false }, // true for IP-based coordinates
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

userLocationSchema.index({ user: 1, type: 1, createdAt: -1 });
// History is kept for 90 days
userLocationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export default mongoose.model('UserLocation', userLocationSchema);
