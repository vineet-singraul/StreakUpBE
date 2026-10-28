import { Router } from 'express';
import { listCalendarMonths, todayStr, currentMonth } from '../utils/date.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ today: todayStr(), currentMonth: currentMonth(), months: listCalendarMonths() });
});

export default router;
