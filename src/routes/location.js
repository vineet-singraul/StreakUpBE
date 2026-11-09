import { Router } from 'express';
import UserLocation from '../models/UserLocation.js';
import LocationConsent from '../models/LocationConsent.js';
import { clientIp, geolocateIp } from '../services/ipGeo.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

const upsert = (userId, update) =>
  LocationConsent.findOneAndUpdate({ user: userId }, update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });

/** IP-based approximate location. The IP is read from the request, never from the body. */
router.post('/ip', rateLimit({ max: 5 }), async (req, res) => {
  let geo;
  try {
    geo = await geolocateIp(clientIp(req));
  } catch {
    return res.status(502).json({ message: 'IP location lookup failed' });
  }
  const now = new Date();
  const prev = await LocationConsent.findOne({ user: req.userId }).select('lastIp').lean();
  // Same IP within 6h: only refresh the snapshot, don't add history
  const sameIp = prev?.lastIp?.ip === geo.ip && now - new Date(prev.lastIp.at) < 6 * 3600 * 1000;
  if (!sameIp) await UserLocation.create({ user: req.userId, type: 'ip', approximate: true, ...geo });
  await upsert(req.userId, { lastIp: { ...geo, at: now }, lastActiveAt: now });
  res.json({ ok: true });
});

export default router;
