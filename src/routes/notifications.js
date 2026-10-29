import { Router } from 'express';
import User from '../models/User.js';
import { sendPush } from '../services/push.js';
import { runReminders } from '../services/scheduler.js';

const router = Router();

router.get('/public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/subscribe', async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ message: 'Invalid push subscription' });
  }
  const user = await User.findById(req.userId);
  user.pushSubscriptions = user.pushSubscriptions.filter((s) => s.endpoint !== sub.endpoint);
  user.pushSubscriptions.push({ endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: sub.keys });
  user.pushReminders = true;
  await user.save();
  res.json({ user: user.toPublic() });
});

router.post('/unsubscribe', async (req, res) => {
  const user = await User.findById(req.userId);
  user.pushSubscriptions = user.pushSubscriptions.filter((s) => s.endpoint !== req.body?.endpoint);
  await user.save();
  res.json({ user: user.toPublic() });
});

router.post('/test', async (req, res) => {
  const user = await User.findById(req.userId);
  const sent = await sendPush(user, {
    title: '🔔 Habit Tracker',
    body: 'Notifications kaam kar rahe hain!',
    url: '/',
  });
  res.json({ sent });
});

// Sends the "pending tasks" reminder (push + email) to yourself right now
router.post('/remind-now', async (req, res) => {
  const { users, pushed, mailed } = await runReminders(req.user._id);
  if (!users) return res.json({ sent: false, message: 'Aaj koi pending task nahi hai' });

  const channels = [mailed && 'email', pushed && 'browser notification'].filter(Boolean);
  res.json({
    sent: channels.length > 0,
    message: channels.length
      ? `Reminder bhej diya (${channels.join(' + ')})`
      : 'Email nahi gaya aur browser notifications ON nahi hain. Upar "Enable" dabao.',
  });
});

export default router;
