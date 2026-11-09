import { Router } from 'express';
import mongoose from 'mongoose';
import User, { adminEmails } from '../models/User.js';
import UserLocation from '../models/UserLocation.js';
import LocationConsent from '../models/LocationConsent.js';

// Mounted behind requireAuth + requireAdmin (see server.js). IP-based tracking only.
const router = Router();
const esc = (s) => String(s).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tiny in-memory memoizer so repeated admin polls don't re-scan the collection every few seconds
function cached(ttlMs, fn) {
  let value;
  let until = 0;
  return async () => {
    if (until > Date.now()) return value;
    value = await fn();
    until = Date.now() + ttlMs;
    return value;
  };
}

// Non-admin user ids change rarely; cache for 30s
const nonAdminIds = cached(30_000, () => User.find({ email: { $nin: adminEmails() } }).distinct('_id'));

// Filter dropdown options (whole collection scan) cached for 60s
const filterOptions = cached(60_000, async () => {
  const [countries, states, cities] = await Promise.all(
    ['lastIp.country', 'lastIp.region', 'lastIp.city'].map((f) => LocationConsent.distinct(f)),
  );
  const clean = (a) => a.filter(Boolean).sort();
  return { countries: clean(countries), states: clean(states), cities: clean(cities) };
});

// Global stats (independent of table filters) cached for 15s
const globalStats = cached(15_000, async () => {
  const base = { user: { $in: await nonAdminIds() } };
  const [totalTracked, ipLocations, latest] = await Promise.all([
    LocationConsent.countDocuments(base),
    LocationConsent.countDocuments({ ...base, 'lastIp.ip': { $exists: true } }),
    LocationConsent.findOne(base).sort({ lastActiveAt: -1 }).select('lastActiveAt').lean(),
  ]);
  return { totalTracked, ipLocations, lastUpdated: latest?.lastActiveAt || null };
});

function row(c, u) {
  const ip = c.lastIp?.ip ? c.lastIp : null;
  return {
    userId: String(u._id),
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    ip: ip?.ip || null,
    isp: ip?.isp || null,
    org: ip?.org || null,
    asn: ip?.asn || null,
    timezone: ip?.timezone || null,
    utcOffset: ip?.utcOffset || null,
    country: ip?.country || null,
    countryCode: ip?.countryCode || null,
    flag: ip?.flag || null,
    continent: ip?.continent || null,
    state: ip?.region || null,
    city: ip?.city || null,
    postal: ip?.postal || null,
    latitude: ip?.latitude ?? null,
    longitude: ip?.longitude ?? null,
    lastActive: c.lastActiveAt,
  };
}

router.get('/stats', async (req, res) => res.json(await globalStats()));

/**
 * One request powers the whole table view: rows + total + stats + filter options.
 * Query: search, country, state, city, sort (latest|oldest), page, limit
 */
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

  const [[result], filters, stats] = await Promise.all([
    LocationConsent.aggregate([
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u', pipeline: [{ $project: { name: 1, email: 1, avatar: 1 } }] } },
      { $unwind: '$u' },
      { $match: match },
      { $sort: { lastActiveAt: sort === 'oldest' ? 1 : -1, _id: 1 } },
      { $facet: { rows: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'n' }] } },
    ]),
    filterOptions(),
    globalStats(),
  ]);

  res.json({
    users: result.rows.map((c) => row(c, c.u)),
    total: result.total[0]?.n || 0,
    page,
    limit,
    filters,
    stats,
  });
});

/** Lightweight map markers: only the fields the map needs, for tracked users with coordinates. */
router.get('/map', async (req, res) => {
  const list = await LocationConsent.find(
    { user: { $in: await nonAdminIds() }, 'lastIp.latitude': { $exists: true } },
    { user: 1, lastActiveAt: 1, 'lastIp.latitude': 1, 'lastIp.longitude': 1, 'lastIp.ip': 1, 'lastIp.city': 1, 'lastIp.region': 1, 'lastIp.country': 1, 'lastIp.flag': 1 },
  )
    .populate('user', 'name email')
    .lean();
  res.json({
    users: list.filter((c) => c.user).map((c) => ({
      userId: String(c.user._id),
      name: c.user.name,
      email: c.user.email,
      ip: c.lastIp.ip,
      city: c.lastIp.city,
      state: c.lastIp.region,
      country: c.lastIp.country,
      flag: c.lastIp.flag,
      latitude: c.lastIp.latitude,
      longitude: c.lastIp.longitude,
      lastActive: c.lastActiveAt,
    })),
  });
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
