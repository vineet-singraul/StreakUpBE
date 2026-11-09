import mongoose from 'mongoose';

const ipSnapshot = {
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
  at: Date,
};

// One document per user: their latest IP-based location snapshot (fast admin listing)
const locationConsentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    lastIp: ipSnapshot,
    lastActiveAt: Date,
  },
  { timestamps: true },
);

locationConsentSchema.index({ lastActiveAt: -1 });

export default mongoose.model('LocationConsent', locationConsentSchema);
