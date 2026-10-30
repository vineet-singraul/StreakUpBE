import { Router } from 'express';
import Challenge from '../models/Challenge.js';
import { todayStr } from '../utils/date.js';

const router = Router();

const POINTS_PER_TICK = 10;
const PERFECT_DAY_BONUS = 20;

// Day number of `date` inside the challenge (1-based)
function dayOf(challenge, date = todayStr()) {
  const [a, b] = [challenge.startDate, date].map((d) => Date.UTC(...d.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))));
  return Math.floor((b - a) / 86400000) + 1;
}

function withStats(c) {
  // An ended challenge is frozen on the day it was ended
  const today = Math.min(dayOf(c, c.active ? todayStr() : c.endedAt || todayStr()), c.days + 1);
  let points = 0;
  let perfectDays = 0;
  for (let d = 1; d <= Math.min(today, c.days); d += 1) {
    const ticked = c.items.filter((i) => i.doneDays.includes(d)).length;
    points += ticked * POINTS_PER_TICK;
    if (c.items.length && ticked === c.items.length) {
      perfectDays += 1;
      points += PERFECT_DAY_BONUS;
    }
  }
  return { ...c, today, points, perfectDays, finished: today > c.days };
}

router.get('/', async (req, res) => {
  const c = await Challenge.findOne({ user: req.userId, active: true }).sort({ createdAt: -1 }).lean();
  res.json({ challenge: c ? withStats(c) : null, rules: { perTick: POINTS_PER_TICK, perfectBonus: PERFECT_DAY_BONUS } });
});

// Start a new challenge today (ends any running one)
router.post('/', async (req, res) => {
  const title = String(req.body?.title || '').trim() || '30 Day Hard Challenge';
  const items = (Array.isArray(req.body?.items) ? req.body.items : [])
    .map((s) => String(s).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 20);
  if (!items.length) return res.status(400).json({ message: 'Add at least one challenge rule' });

  await Challenge.updateMany({ user: req.userId, active: true }, { $set: { active: false, endedAt: todayStr() } });
  const c = await Challenge.create({ user: req.userId, title, startDate: todayStr(), items: items.map((name) => ({ name })) });
  res.status(201).json({ challenge: withStats(c.toObject()) });
});

// Edit the running challenge: title, rename / add / remove rules (ticks of kept rules stay)
router.patch('/', async (req, res) => {
  const c = await Challenge.findOne({ user: req.userId, active: true }).sort({ createdAt: -1 });
  if (!c) return res.status(404).json({ message: 'Challenge not found' });

  const title = String(req.body?.title || '').trim();
  if (title) c.title = title.slice(0, 80);

  if (Array.isArray(req.body?.items)) {
    const incoming = req.body.items
      .map((i) => ({ _id: i?._id, name: String(i?.name || '').trim().slice(0, 80) }))
      .filter((i) => i.name)
      .slice(0, 20);
    if (!incoming.length) return res.status(400).json({ message: 'Add at least one challenge rule' });
    c.items = incoming.map((i) => {
      const old = i._id && c.items.id(i._id);
      return old ? { _id: old._id, name: i.name, doneDays: old.doneDays } : { name: i.name, doneDays: [] };
    });
  }
  await c.save();
  res.json({ challenge: withStats(c.toObject()) });
});

// All past + current challenges, newest first (History list)
router.get('/history', async (req, res) => {
  const list = await Challenge.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    challenges: list.map((c) => {
      const s = withStats(c);
      return { _id: c._id, title: c.title, startDate: c.startDate, endedAt: c.endedAt, active: c.active, days: c.days, rules: c.items.length, points: s.points, perfectDays: s.perfectDays, dayReached: Math.min(s.today, c.days), finished: s.finished };
    }),
  });
});

// One challenge with its full grid (read-only view from History)
router.get('/:id', async (req, res) => {
  const c = await Challenge.findOne({ _id: req.params.id, user: req.userId }).lean();
  if (!c) return res.status(404).json({ message: 'Challenge not found' });
  res.json({ challenge: withStats(c) });
});

// Tick / untick today's box for one rule
router.patch('/items/:itemId/toggle', async (req, res) => {
  const c = await Challenge.findOne({ user: req.userId, active: true, 'items._id': req.params.itemId });
  if (!c) return res.status(404).json({ message: 'Challenge not found' });
  const day = dayOf(c);
  if (day < 1 || day > c.days) return res.status(403).json({ message: 'Challenge is over' });

  const item = c.items.id(req.params.itemId);
  const i = item.doneDays.indexOf(day);
  if (i >= 0) item.doneDays.splice(i, 1);
  else item.doneDays.push(day);
  await c.save();
  res.json({ challenge: withStats(c.toObject()) });
});

router.delete('/', async (req, res) => {
  await Challenge.updateMany({ user: req.userId, active: true }, { $set: { active: false, endedAt: todayStr() } });
  res.json({ ok: true });
});

export default router;
