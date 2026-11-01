import jwt from 'jsonwebtoken';
import User, { adminEmail } from '../models/User.js';

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
    next();
  } catch {
    res.status(401).json({ message: 'Session expired, please sign in again' });
  }
}

// Use after requireAuth: only the ADMIN_EMAIL account gets through
export async function requireAdmin(req, res, next) {
  const user = await User.findById(req.userId).select('email').lean();
  if (user?.email !== adminEmail()) return res.status(403).json({ message: 'Admin only' });
  next();
}
