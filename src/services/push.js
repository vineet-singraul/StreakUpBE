import webpush from 'web-push';

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

/** Sends a browser notification to every device the user enabled. Removes dead subscriptions. */
export async function sendPush(user, payload) {
  if (!ensureConfigured() || !user.pushSubscriptions?.length) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;
  const dead = [];

  await Promise.all(
    user.pushSubscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(sub.endpoint);
        else console.error('Push failed:', err.statusCode || err.message);
      }
    }),
  );

  if (dead.length) {
    user.pushSubscriptions = user.pushSubscriptions.filter((s) => !dead.includes(s.endpoint));
    await user.save();
  }
  return sent;
}
