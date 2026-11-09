import { Router } from 'express';
import Habit from '../models/Habit.js';
import { computeProfile } from '../services/gamification.js';

const router = Router();

/** The signed-in user's XP, level, streaks and badges (derived from all their habits). */
router.get('/me', async (req, res) => {
  const habits = await Habit.find({ user: req.userId }).select('completedDates').lean();
  res.json(computeProfile(habits));
});

export default router;
