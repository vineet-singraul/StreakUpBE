import { Router } from 'express';
import User, { adminEmails, isAdminEmail } from '../models/User.js';
import Habit from '../models/Habit.js';
import Task from '../models/Task.js';
import Challenge from '../models/Challenge.js';
import { setBlocked } from '../services/blocked.js';

const router = Router();

// Number of documents per user, as { userId: count }
async function countByUser(Model) {
  const rows = await Model.aggregate([{ $group: { _id: '$user', n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

/** Every user (except the admins) with profile, settings, location and activity counts. */
router.get('/users', async (req, res) => {
  const [users, habits, tasks, challenges] = await Promise.all([
    User.find({ email: { $nin: adminEmails() } }).sort({ lastLoginAt: -1, createdAt: -1 }).lean(),
    countByUser(Habit),
    countByUser(Task),
    countByUser(Challenge),
  ]);

  res.json({
    users: users.map((u) => {
      const id = String(u._id);
      return {
        id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        language: u.language || 'hinglish',
        emailReminders: u.emailReminders,
        pushReminders: u.pushReminders,
        pushDevices: u.pushSubscriptions?.length || 0,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        lastLocation: u.lastLocation?.latitude != null ? u.lastLocation : null,
        blocked: Boolean(u.blocked),
        blockedAt: u.blockedAt,
        habits: habits[id] || 0,
        tasks: tasks[id] || 0,
        challenges: challenges[id] || 0,
      };
    }),
  });
});

/** Block or unblock a user: { blocked: true | false }. A blocked user can't sign in or use the API. */
router.patch('/users/:id/block', async (req, res) => {
  if (typeof req.body?.blocked !== 'boolean') return res.status(400).json({ message: 'blocked must be true or false' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (isAdminEmail(user.email)) return res.status(400).json({ message: 'Admin ko block nahi kar sakte' });

  user.blocked = req.body.blocked;
  user.blockedAt = req.body.blocked ? new Date() : undefined;
  await user.save();
  setBlocked(user._id, user.blocked);
  res.json({ blocked: user.blocked, blockedAt: user.blockedAt });
});

/** A user's tasks, newest date first. */
router.get('/users/:id/tasks', async (req, res) => {
  const tasks = await Task.find({ user: req.params.id })
    .sort({ date: -1, createdAt: 1 })
    .limit(1000)
    .select('date title done doneAt createdAt')
    .lean();
  res.json({ tasks: tasks.map(({ _id, ...t }) => ({ id: _id, ...t })) });
});

router.delete('/tasks/:taskId', async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.taskId);
  if (!task) return res.status(404).json({ message: 'Task not found' });
  res.json({ ok: true });
});

export default router;
