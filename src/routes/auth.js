import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import User, { isAdminEmail } from '../models/User.js';
import { BLOCKED_MESSAGE, requireAuth, signToken, touchSeen, forgetSeen } from '../middleware/auth.js';

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
    // The admin can use either tab; everyone else must sign up first
    if (mode !== 'signup' && !isAdminEmail(payload.email)) {
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

  if (user.blocked) return res.status(403).json({ message: BLOCKED_MESSAGE, blocked: true });

  user.lastLoginAt = new Date();
  user.lastSeenAt = user.lastLoginAt;
  if (payload.picture) user.avatar = payload.picture;
  await user.save();

  res.json({ token: signToken(user._id), user: user.toPublic(), isNew });
});

// Heartbeat from an open app tab, keeps the user "online" for the admin panel
router.post('/ping', requireAuth, (req, res) => {
  touchSeen(req.userId, true);
  res.json({ ok: true });
});

// Marks the user offline right away instead of waiting for the online window to expire
router.post('/logout', requireAuth, async (req, res) => {
  forgetSeen(req.userId);
  await User.updateOne({ _id: req.userId }, { $set: { loggedOutAt: new Date(Date.now() + 1000) } });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ message: 'User not found' });
  res.json({ user: user.toPublic() });
});

/** Saves the browser's latitude/longitude, sent by the frontend right after login. */
router.post('/location', requireAuth, async (req, res) => {
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const accuracy = Number(req.body?.accuracy);
  const valid =
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (!valid) return res.status(400).json({ message: 'Invalid latitude/longitude' });

  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ message: 'User not found' });
  user.lastLocation = {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
    capturedAt: new Date(),
  };
  await user.save();
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
