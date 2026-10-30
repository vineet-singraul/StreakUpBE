import mongoose from 'mongoose';
import Task from '../models/Task.js';
import Report from '../models/Report.js';
import User from '../models/User.js';
import { dailySummary } from './gemini.js';
import { lastNDays } from '../utils/date.js';

/** Per-day task totals for the `count` days ending at `end`; days without tasks have total 0 */
export async function dailyStats(userId, end, count) {
  const dates = lastNDays(end, count);
  const rows = await Task.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)), date: { $gte: dates[0], $lte: end } } },
    { $group: { _id: '$date', total: { $sum: 1 }, done: { $sum: { $cond: ['$done', 1, 0] } } } },
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r]));
  return dates.map((date) => ({ date, total: byDate.get(date)?.total || 0, done: byDate.get(date)?.done || 0 }));
}

/** Builds (or rebuilds) the report for one user + day. Returns null if the user had no tasks. */
export async function buildDailyReport(userId, date, { final = false } = {}) {
  const [tasks, user] = await Promise.all([
    Task.find({ user: userId, date }).sort({ createdAt: 1 }).lean(),
    User.findById(userId).select('name').lean(),
  ]);
  if (!tasks.length) return null;

  const done = tasks.filter((t) => t.done);
  const pending = tasks.filter((t) => !t.done);

  const aiSummary = await dailySummary({
    name: user?.name?.split(' ')[0] || 'Friend',
    date,
    completed: done.map((t) => t.title),
    pending: pending.map((t) => t.title),
    final,
  });

  return Report.findOneAndUpdate(
    { user: userId, date },
    {
      $set: {
        total: tasks.length,
        completedCount: done.length,
        completed: done.map((t) => t.title),
        pending: pending.map((t) => ({ task: t._id, title: t.title, reason: '' })),
        aiSummary,
        final,
        reasonsSubmitted: false,
        aiFeedback: '',
        generatedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', lean: true },
  );
}
