import crypto from 'node:crypto';
import Reminder from '../models/Reminder.js';

// The "Stop" / "Snooze" buttons on a reminder notification are handled by the service worker,
// which has no login token. Each notification instead carries a per-reminder signed key.

export function actionKey(id) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev-secret').update(`reminder:${id}`).digest('base64url').slice(0, 32);
}

/** Absolute URL the service worker POSTs to (relative "/api" works in local dev through the Vite proxy) */
export function actionUrl(id) {
  const base = (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  return `${base}/api/reminder-action/${id}?key=${actionKey(id)}`;
}

export const stopReminder = (filter) => Reminder.updateOne(filter, { $set: { done: true, sent: true } });

export const snoozeReminder = (filter, minutes = 5) =>
  Reminder.updateOne(filter, { $set: { at: new Date(Date.now() + minutes * 60_000), rings: 0, done: false, sent: false } });

/** POST /api/reminder-action/:id?key=...&do=stop|snooze  (no login; the key proves it came from the notification) */
export async function reminderActionHandler(req, res) {
  const { id } = req.params;
  const given = Buffer.from(String(req.query.key || ''));
  const expected = Buffer.from(actionKey(id));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(403).json({ message: 'Invalid key' });
  }
  if (req.query.do === 'snooze') await snoozeReminder({ _id: id });
  else await stopReminder({ _id: id });
  res.json({ ok: true });
}
