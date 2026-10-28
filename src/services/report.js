import Task from '../models/Task.js';
import Report from '../models/Report.js';
import User from '../models/User.js';
import { dailySummary } from './gemini.js';

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
