import jwt from 'jsonwebtoken';
import User, { isAdminEmail } from '../models/User.js';
import { isBlocked } from '../services/blocked.js';

export const BLOCKED_MESSAGE = 'Aapka account block kar diya gaya hai. Admin se contact karo.';

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Please sign in' });
  try {
    req.userId = jwt.verify(token, process.env.JWT_SECRET).sub;
  } catch {
    return res.status(401).json({ message: 'Session expired, please sign in again' });
  }
  if (isBlocked(req.userId)) return res.status(403).json({ message: BLOCKED_MESSAGE, blocked: true });
  next();
}

// Use after requireAuth: only ADMIN_EMAILS accounts get through
export async function requireAdmin(req, res, next) {
  const user = await User.findById(req.userId).select('email').lean();
  if (!isAdminEmail(user?.email)) return res.status(403).json({ message: 'Admin only' });
  next();
}
