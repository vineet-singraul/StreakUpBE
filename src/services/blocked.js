import User from '../models/User.js';

// Blocked user ids kept in memory so requireAuth can reject them without a DB query per request.
// Loaded once at startup; the admin routes keep it in sync when they block/unblock.
const blockedIds = new Set();

export async function loadBlocked() {
  const rows = await User.find({ blocked: true }).select('_id').lean();
  blockedIds.clear();
  for (const r of rows) blockedIds.add(String(r._id));
}

export const isBlocked = (userId) => blockedIds.has(String(userId));

export function setBlocked(userId, blocked) {
  if (blocked) blockedIds.add(String(userId));
  else blockedIds.delete(String(userId));
}
