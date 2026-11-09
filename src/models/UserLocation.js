import mongoose from 'mongoose';

// IP location history: one document per lookup (near-duplicate IPs are skipped by the route)
const userLocationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['ip'], default: 'ip' },
    ip: String,
    country: String,
    countryCode: String,
    region: String,
    city: String,
    postal: String,
    continent: String,
    latitude: Number,
    longitude: Number,
    isp: String,
    org: String,
    asn: String,
    timezone: String,
    utcOffset: String,
    flag: String,
    approximate: { type: Boolean, default: true }, // IP coordinates are always approximate
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

userLocationSchema.index({ user: 1, createdAt: -1 });
// History is kept for 90 days
userLocationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export default mongoose.model('UserLocation', userLocationSchema);
