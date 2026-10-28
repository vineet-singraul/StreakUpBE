import { Router } from 'express';
import Task from '../models/Task.js';
import Report from '../models/Report.js';
import { DATE_RE, MONTH_RE, todayStr, isMonthUnlocked } from '../utils/date.js';

const router = Router();

// Only reached when a single-query update matched nothing: tell "missing" apart from "not today"
async function notEditable(req, res) {
  const exists = await Task.exists({ _id: req.params.id, user: req.userId });
  if (!exists) return res.status(404).json({ message: 'Task not found' });
  return res.status(403).json({ message: 'Sirf aaj ke tasks add / edit ho sakte hain' });
}

// Per-day summary for a month calendar: [{ date, total, done }]
router.get('/month', async (req, res) => {
  const { month } = req.query;
  if (!MONTH_RE.test(month || '')) return res.status(400).json({ message: 'month=YYYY-MM required' });
  if (!isMonthUnlocked(month)) return res.status(403).json({ message: 'Ye month abhi locked hai' });

  const days = await Task.aggregate([
    { $match: { user: req.user._id, date: { $gte: `${month}-01`, $lte: `${month}-31` } } },
    { $group: { _id: '$date', total: { $sum: 1 }, done: { $sum: { $cond: ['$done', 1, 0] } } } },
    { $project: { _id: 0, date: '$_id', total: 1, done: 1 } },
  ]);
  res.json({ month, days });
});

// Tasks + that day's report in one request (both queries run in parallel)
router.get('/', async (req, res) => {
  const today = todayStr();
  const date = req.query.date || today;
  if (!DATE_RE.test(date)) return res.status(400).json({ message: 'date=YYYY-MM-DD required' });
  if (date > today || !isMonthUnlocked(date.slice(0, 7))) {
    return res.status(403).json({ message: 'Future dates abhi open nahi hain' });
  }

  const [tasks, report] = await Promise.all([
    Task.find({ user: req.userId, date }).sort({ createdAt: 1 }).lean(),
    Report.findOne({ user: req.userId, date }).lean(),
  ]);
  res.json({ date, today, editable: date === today, tasks, report });
});

router.post('/', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Task title required' });
  const date = todayStr();
  if (!isMonthUnlocked(date.slice(0, 7))) return res.status(403).json({ message: 'Ye month calendar me nahi hai' });

  const task = await Task.create({ user: req.userId, date, title });
  res.status(201).json({ task });
});

router.patch('/:id', async (req, res) => {
  const set = {};
  const unset = {};
  if (typeof req.body?.done === 'boolean') {
    set.done = req.body.done;
    if (req.body.done) set.doneAt = new Date();
    else unset.doneAt = 1;
  }
  if (typeof req.body?.title === 'string' && req.body.title.trim()) set.title = req.body.title.trim().slice(0, 200);
  if (!Object.keys(set).length && !Object.keys(unset).length) return res.status(400).json({ message: 'Nothing to update' });

  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, user: req.userId, date: todayStr() },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after', lean: true },
  );
  if (!task) return notEditable(req, res);
  res.json({ task });
});

router.delete('/:id', async (req, res) => {
  const { deletedCount } = await Task.deleteOne({ _id: req.params.id, user: req.userId, date: todayStr() });
  if (!deletedCount) return notEditable(req, res);
  res.json({ ok: true });
});

export default router;
