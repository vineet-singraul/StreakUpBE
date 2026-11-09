import mongoose from 'mongoose';

const snapshot = {
  latitude: Number,
  longitude: Number,
  accuracy: Number,
  ip: String,
  country: String,
  region: String,
  city: String,
  isp: String,
  timezone: String,
  at: Date,
};

// One document per user: GPS consent/tracking state + latest IP and GPS snapshot (fast admin listing)
const locationConsentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    gpsConsent: { type: Boolean, default: false },
    permission: { type: String, enum: ['granted', 'denied', 'prompt', 'unavailable', 'unknown'], default: 'unknown' },
    tracking: { type: Boolean, default: false }, // currently sharing live GPS
    consentedAt: Date,
    stoppedAt: Date,
    lastIp: snapshot,
    lastGps: snapshot,
    lastActiveAt: Date,
  },
  { timestamps: true },
);

locationConsentSchema.index({ lastActiveAt: -1 });
locationConsentSchema.index({ tracking: 1, 'lastGps.at': -1 });

export default mongoose.model('LocationConsent', locationConsentSchema);
