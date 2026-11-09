import { Router } from 'express';
import mongoose from 'mongoose';
import User, { adminEmails } from '../models/User.js';
import UserLocation from '../models/UserLocation.js';
import LocationConsent from '../models/LocationConsent.js';

// Mounted behind requireAuth + requireAdmin (see server.js). IP-based tracking only.
const router = Router();
const esc = (s) => String(s).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function row(c, u) {
  const ip = c.lastIp?.ip ? c.lastIp : null;
  return {
    userId: String(u._id),
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    ip: ip?.ip || null,
    isp: ip?.isp || null,
    timezone: ip?.timezone || null,
    country: ip?.country || null,
    state: ip?.region || null,
    city: ip?.city || null,
    latitude: ip?.latitude ?? null,
    longitude: ip?.longitude ?? null,
    lastActive: c.lastActiveAt,
  };
}

const nonAdminIds = () => User.find({ email: { $nin: adminEmails() } }).distinct('_id');

router.get('/stats', async (req, res) => {
  const base = { user: { $in: await nonAdminIds() } };
  const [totalTracked, ipLocations, latest] = await Promise.all([
    LocationConsent.countDocuments(base),
    LocationConsent.countDocuments({ ...base, 'lastIp.ip': { $exists: true } }),
    LocationConsent.findOne(base).sort({ lastActiveAt: -1 }).select('lastActiveAt').lean(),
  ]);
  res.json({ totalTracked, ipLocations, lastUpdated: latest?.lastActiveAt || null });
});

/** Query: search, country, state, city, sort (latest|oldest), page, limit */
router.get('/users', async (req, res) => {
  const { search, country, state, city, sort } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

  const match = { 'u.email': { $nin: adminEmails() } };
  if (search) {
    const rx = new RegExp(esc(search), 'i');
    match.$or = [{ 'u.name': rx }, { 'u.email': rx }, { 'lastIp.ip': rx }, { 'lastIp.city': rx }];
  }
  for (const [val, field] of [[country, 'lastIp.country'], [state, 'lastIp.region'], [city, 'lastIp.city']]) {
    if (val) match[field] = new RegExp(`^${esc(val)}$`, 'i');
  }

  const [[result], countries, states, cities] = await Promise.all([
    LocationConsent.aggregate([
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u', pipeline: [{ $project: { name: 1, email: 1, avatar: 1 } }] } },
      { $unwind: '$u' },
      { $match: match },
      { $sort: { lastActiveAt: sort === 'oldest' ? 1 : -1, _id: 1 } },
      { $facet: { rows: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'n' }] } },
    ]),
    ...['lastIp.country', 'lastIp.region', 'lastIp.city'].map((f) => LocationConsent.distinct(f)),
  ]);

  const clean = (a) => a.filter(Boolean).sort();
  res.json({
    users: result.rows.map((c) => row(c, c.u)),
    total: result.total[0]?.n || 0,
    page,
    limit,
    filters: { countries: clean(countries), states: clean(states), cities: clean(cities) },
  });
});

/** Every tracked user's IP point, for the map. */
router.get('/map', async (req, res) => {
  const list = await LocationConsent.find({ user: { $in: await nonAdminIds() }, 'lastIp.latitude': { $exists: true } })
    .populate('user', 'name email avatar')
    .lean();
  res.json({ users: list.filter((c) => c.user).map((c) => row(c, c.user)) });
});

/** One user's details and recent IP history (last 50). */
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ message: 'Invalid id' });
  const [user, consent, history] = await Promise.all([
    User.findById(userId).select('name email avatar').lean(),
    LocationConsent.findOne({ user: userId }).lean(),
    UserLocation.find({ user: userId }).sort({ createdAt: -1 }).limit(50).select('-__v -user').lean(),
  ]);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: row(consent || {}, user), history });
});

export default router;
