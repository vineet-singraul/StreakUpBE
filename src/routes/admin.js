import { Router } from 'express';
import User, { adminEmail } from '../models/User.js';
import Habit from '../models/Habit.js';
import Task from '../models/Task.js';
import Challenge from '../models/Challenge.js';

const router = Router();

// Number of documents per user, as { userId: count }
async function countByUser(Model) {
  const rows = await Model.aggregate([{ $group: { _id: '$user', n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

/** Every user (except the admin) with profile, settings, location and activity counts. */
router.get('/users', async (req, res) => {
  const [users, habits, tasks, challenges] = await Promise.all([
    User.find({ email: { $ne: adminEmail() } }).sort({ lastLoginAt: -1, createdAt: -1 }).lean(),
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
        habits: habits[id] || 0,
        tasks: tasks[id] || 0,
        challenges: challenges[id] || 0,
      };
    }),
  });
});

export default router;
