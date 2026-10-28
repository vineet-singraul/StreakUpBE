import { Router } from 'express';
import Report from '../models/Report.js';
import User from '../models/User.js';
import { buildDailyReport } from '../services/report.js';
import { reasonsFeedback, isGeminiConfigured } from '../services/gemini.js';
import { DATE_RE, todayStr } from '../utils/date.js';

const router = Router();

router.get('/', async (req, res) => {
  const reports = await Report.find({ user: req.userId }).sort({ date: -1 }).limit(60).lean();
  res.json({ reports, aiEnabled: isGeminiConfigured() });
});

// Latest finished day whose pending tasks still need a "why?" answer
router.get('/awaiting-reasons', async (req, res) => {
  const report = await Report.findOne({
    user: req.userId,
    final: true,
    reasonsSubmitted: false,
    'pending.0': { $exists: true },
  }).sort({ date: -1 }).lean();
  res.json({ report });
});

router.get('/by-date/:date', async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ message: 'Invalid date' });
  const report = await Report.findOne({ user: req.userId, date: req.params.date }).lean();
  res.json({ report });
});

// On-demand AI report for today (the 12 AM job makes the final one)
router.post('/generate', async (req, res) => {
  const today = todayStr();
  const existing = await Report.findOne({ user: req.userId, date: today, final: true }).lean();
  if (existing) return res.json({ report: existing });

  const report = await buildDailyReport(req.userId, today, { final: false });
  if (!report) return res.status(400).json({ message: 'Aaj koi task nahi hai. Pehle tasks add karo.' });
  res.json({ report });
});

// User explains why pending tasks were not done -> Gemini coaching feedback
router.post('/:id/reasons', async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, user: req.userId });
  if (!report) return res.status(404).json({ message: 'Report not found' });

  const reasons = req.body?.reasons || {};
  for (const p of report.pending) {
    const r = reasons[String(p.task)] ?? reasons[p.title];
    if (typeof r === 'string') p.reason = r.trim().slice(0, 500);
  }

  const user = await User.findById(req.userId).select('name').lean();
  report.aiFeedback = await reasonsFeedback({
    name: user?.name?.split(' ')[0] || 'Friend',
    date: report.date,
    items: report.pending.map((p) => ({ title: p.title, reason: p.reason })),
  });
  report.reasonsSubmitted = true;
  await report.save();
  res.json({ report });
});

export default router;
