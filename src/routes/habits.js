import { Router } from 'express';
import Habit from '../models/Habit.js';
import { MONTH_RE, todayStr, currentMonth, isMonthUnlocked } from '../utils/date.js';

const router = Router();

// Only reached when a single-query update matched nothing: tell "missing" apart from "old month"
async function notEditable(req, res) {
  const exists = await Habit.exists({ _id: req.params.id, user: req.userId });
  if (!exists) return res.status(404).json({ message: 'Habit not found' });
  return res.status(403).json({ message: 'Sirf current month ki habits badal sakti hain' });
}

router.get('/', async (req, res) => {
  const month = req.query.month || currentMonth();
  if (!MONTH_RE.test(month)) return res.status(400).json({ message: 'month=YYYY-MM required' });
  if (!isMonthUnlocked(month)) return res.status(403).json({ message: 'Ye month abhi locked hai' });

  const habits = await Habit.find({ user: req.userId, month }).sort({ createdAt: 1 }).lean();
  res.json({ month, today: todayStr(), editable: month === currentMonth(), habits });
});

// Habits can only be created for the running month
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Habit name required' });
  const month = currentMonth();
  if (!isMonthUnlocked(month)) return res.status(403).json({ message: 'Ye month calendar me nahi hai' });

  const habit = await Habit.create({ user: req.userId, month, name });
  res.status(201).json({ habit });
});

// Copy last month's habit names into the running month
router.post('/copy-previous', async (req, res) => {
  const month = currentMonth();
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;

  const [prevHabits, existing] = await Promise.all([
    Habit.find({ user: req.userId, month: prev }).select('name').lean(),
    Habit.find({ user: req.userId, month }).select('name').lean(),
  ]);
  const have = new Set(existing.map((h) => h.name.toLowerCase()));
  const toCreate = prevHabits
    .filter((h) => !have.has(h.name.toLowerCase()))
    .map((h) => ({ user: req.userId, month, name: h.name }));
  const created = toCreate.length ? await Habit.insertMany(toCreate) : [];
  res.json({ created: created.length });
});

// Tick / untick today in a single atomic query
router.patch('/:id/toggle', async (req, res) => {
  const today = todayStr();
  const habit = await Habit.findOneAndUpdate(
    { _id: req.params.id, user: req.userId, month: currentMonth() },
    [
      {
        $set: {
          completedDates: {
            $cond: [
              { $in: [today, '$completedDates'] },
              { $setDifference: ['$completedDates', [today]] },
              { $concatArrays: ['$completedDates', [today]] },
            ],
          },
        },
      },
    ],
    { returnDocument: 'after', lean: true, updatePipeline: true },
  );
  if (!habit) return notEditable(req, res);
  res.json({ habit });
});

router.patch('/:id', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ message: 'Habit name required' });
  const habit = await Habit.findOneAndUpdate(
    { _id: req.params.id, user: req.userId, month: currentMonth() },
    { $set: { name } },
    { returnDocument: 'after', lean: true },
  );
  if (!habit) return notEditable(req, res);
  res.json({ habit });
});

router.delete('/:id', async (req, res) => {
  const { deletedCount } = await Habit.deleteOne({ _id: req.params.id, user: req.userId, month: currentMonth() });
  if (!deletedCount) return notEditable(req, res);
  res.json({ ok: true });
});

export default router;
