import { Router } from 'express';
import Challenge from '../models/Challenge.js';
import { todayStr } from '../utils/date.js';

const router = Router();

const POINTS_PER_TICK = 10;
const PERFECT_DAY_BONUS = 20;
const MIN_DAYS = 10;
const MAX_DAYS = 90;
const MAX_RUNNING = 10;

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

// Several challenges can run side by side; finished ones drop out (they show as Completed in History)
const runningFor = async (userId) => (await Challenge.find({ user: userId, active: true }).sort({ createdAt: 1 }).lean())
  .map(withStats)
  .filter((c) => !c.finished);

router.get('/', async (req, res) => {
  const challenges = await runningFor(req.userId);
  res.json({ challenges, challenge: challenges.at(-1) || null, rules: { perTick: POINTS_PER_TICK, perfectBonus: PERFECT_DAY_BONUS } });
});

// Start a new challenge today; challenges already running keep going
router.post('/', async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ message: 'Challenge title is required' });
  const days = Number(req.body?.days);
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    return res.status(400).json({ message: `Days must be between ${MIN_DAYS} and ${MAX_DAYS}` });
  }
  const items = (Array.isArray(req.body?.items) ? req.body.items : [])
    .map((s) => String(s).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 20);
  if (!items.length) return res.status(400).json({ message: 'Add at least one challenge rule' });

  if ((await runningFor(req.userId)).length >= MAX_RUNNING) {
    return res.status(400).json({ message: `Max ${MAX_RUNNING} challenges can run at once` });
  }
  const c = await Challenge.create({ user: req.userId, title, days, startDate: todayStr(), items: items.map((name) => ({ name })) });
  res.status(201).json({ challenge: withStats(c.toObject()) });
});

// Edit a running challenge: title, rename / add / remove rules (ticks of kept rules stay).
// PATCH / (no id) edits the newest one, for older app versions.
router.patch(['/', '/:id'], async (req, res) => {
  const filter = { user: req.userId, active: true, ...(req.params.id && { _id: req.params.id }) };
  const c = await Challenge.findOne(filter).sort({ createdAt: -1 });
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

// Continue a challenge that was ended early, if its days are not over yet (missed days stay ✗)
router.post('/:id/resume', async (req, res) => {
  const c = await Challenge.findOne({ _id: req.params.id, user: req.userId });
  if (!c) return res.status(404).json({ message: 'Challenge not found' });
  if (dayOf(c) > c.days) return res.status(400).json({ message: 'Challenge days are already over' });
  if (!c.active && (await runningFor(req.userId)).length >= MAX_RUNNING) {
    return res.status(400).json({ message: `Max ${MAX_RUNNING} challenges can run at once` });
  }
  c.active = true;
  c.endedAt = undefined;
  await c.save();
  res.json({ challenge: withStats(c.toObject()) });
});

// End one challenge (DELETE / without id ends all, for older app versions)
router.delete(['/', '/:id'], async (req, res) => {
  const filter = { user: req.userId, active: true, ...(req.params.id && { _id: req.params.id }) };
  await Challenge.updateMany(filter, { $set: { active: false, endedAt: todayStr() } });
  res.json({ ok: true });
});

export default router;
