import { Router } from 'express';
import User from '../models/User.js';
import { chat } from '../services/chatbot.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Each message costs 2 Gemini calls, so keep it modest per user
router.post('/', rateLimit({ windowMs: 60_000, max: 8 }), async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ message: 'Message khaali hai' });
  if (message.length > 500) return res.status(400).json({ message: 'Message 500 characters se chhota rakho' });

  const user = await User.findById(req.userId).select('name language').lean();
  const result = await chat({
    userId: req.userId,
    name: user?.name?.split(' ')[0] || 'Friend',
    language: user?.language,
    message,
    history: req.body?.history,
  });
  res.json(result);
});

export default router;
