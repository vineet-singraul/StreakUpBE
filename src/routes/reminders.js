import { Router } from 'express';
import Reminder, { TONES } from '../models/Reminder.js';
import { stopReminder } from '../services/reminderActions.js';

const router = Router();
const MAX_PENDING = 100;
const KEEP_PAST_DAYS = 7;

/** Validates the editable fields; returns { data } or { error } */
function parse(body, partial = false) {
  const data = {};
  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (!title) return { error: 'Reminder ka title likho' };
    if (title.length > 200) return { error: 'Title 200 characters se chhota rakho' };
    data.title = title;
  }
  if (!partial || body.at !== undefined) {
    const at = new Date(body.at);
    if (Number.isNaN(at.getTime())) return { error: 'Date / time sahi nahi hai' };
    if (at.getTime() < Date.now() - 60_000) return { error: 'Ye time nikal chuka hai, aage ka time chuno' };
    if (at.getTime() > Date.now() + 366 * 86_400_000) return { error: 'Ek saal ke andar ka time chuno' };
    data.at = at;
  }
  if (body.tone !== undefined) {
    if (!TONES.includes(body.tone)) return { error: 'Invalid tone' };
    data.tone = body.tone;
  }
  if (body.speak !== undefined) data.speak = Boolean(body.speak);
  return { data };
}

// Upcoming first, then the last week's finished ones
router.get('/', async (req, res) => {
  const since = new Date(Date.now() - KEEP_PAST_DAYS * 86_400_000);
  const reminders = await Reminder.find({ user: req.userId, at: { $gte: since } }).sort({ at: 1 }).limit(300).lean();
  res.json({ reminders, now: new Date().toISOString() });
});

router.post('/', async (req, res) => {
  const { data, error } = parse(req.body);
  if (error) return res.status(400).json({ message: error });
  const pending = await Reminder.countDocuments({ user: req.userId, sent: false });
  if (pending >= MAX_PENDING) return res.status(400).json({ message: `Ek saath ${MAX_PENDING} se zyada reminders nahi rakh sakte` });
  const reminder = await Reminder.create({ ...data, user: req.userId });
  res.status(201).json({ reminder });
});

// Edit, or snooze (send a new `at`): a new time makes it ring again
router.patch('/:id', async (req, res) => {
  const { data, error } = parse(req.body, true);
  if (error) return res.status(400).json({ message: error });
  if (data.at) Object.assign(data, { sent: false, rings: 0, done: false });
  const reminder = await Reminder.findOneAndUpdate({ _id: req.params.id, user: req.userId }, data, { returnDocument: 'after', lean: true });
  if (!reminder) return res.status(404).json({ message: 'Reminder nahi mila' });
  res.json({ reminder });
});

// "Stop" on the in-app alarm screen: no more re-ring pushes
router.post('/:id/stop', async (req, res) => {
  await stopReminder({ _id: req.params.id, user: req.userId });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await Reminder.deleteOne({ _id: req.params.id, user: req.userId });
  res.json({ ok: true });
});

export default router;
