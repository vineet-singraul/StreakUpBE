import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();
const googleClient = new OAuth2Client();

/**
 * Login with Google only.
 * mode = "signup" creates the account if new; mode = "signin" requires an existing account.
 */
router.post('/google', async (req, res) => {
  const { credential, mode = 'signin' } = req.body || {};
  if (!credential) return res.status(400).json({ message: 'Google credential missing' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error('Google token verify failed:', err.message);
    return res.status(401).json({ message: 'Google login failed, please try again' });
  }

  if (!payload?.email_verified) return res.status(401).json({ message: 'Google email not verified' });

  let user = await User.findOne({ googleId: payload.sub });
  let isNew = false;

  if (!user) {
    if (mode !== 'signup') {
      return res.status(404).json({ message: 'Account nahi mila. Pehle "Sign Up" karo.', needSignup: true });
    }
    user = await User.create({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      avatar: payload.picture,
    });
    isNew = true;
  }

  user.lastLoginAt = new Date();
  if (payload.picture) user.avatar = payload.picture;
  await user.save();

  res.json({ token: signToken(user._id), user: user.toPublic(), isNew });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ message: 'User not found' });
  res.json({ user: user.toPublic() });
});

router.patch('/settings', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ message: 'User not found' });
  for (const key of ['emailReminders', 'pushReminders']) {
    if (typeof req.body?.[key] === 'boolean') user[key] = req.body[key];
  }
  if (['en', 'hi', 'hinglish'].includes(req.body?.language)) user.language = req.body.language;
  await user.save();
  res.json({ user: user.toPublic() });
});

export default router;
