import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import taskRoutes from './routes/tasks.js';
import habitRoutes from './routes/habits.js';
import reportRoutes from './routes/reports.js';
import notificationRoutes from './routes/notifications.js';
import { startScheduler } from './services/scheduler.js';

const app = express();

app.set('etag', false); // data changes every click; avoid 304 revalidation round-trips
app.use(compression());
// CLIENT_URL may list several origins, e.g. "https://myapp.vercel.app,http://localhost:5173"
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim().replace(/\/$/, ''));
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// aggregate() needs an ObjectId, so expose it alongside req.userId
const withUser = [requireAuth, (req, res, next) => {
  req.user = { _id: new mongoose.Types.ObjectId(req.userId) };
  next();
}];

app.use('/api/auth', authRoutes);
app.use('/api/calendar', withUser, calendarRoutes);
app.use('/api/tasks', withUser, taskRoutes);
app.use('/api/habits', withUser, habitRoutes);
app.use('/api/reports', withUser, reportRoutes);
app.use('/api/notifications', withUser, notificationRoutes);

app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Express 5 forwards async errors here
app.use((err, req, res, next) => {
  console.error(err);
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id' });
  res.status(500).json({ message: 'Server error' });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
    startScheduler();
  })
  .catch((err) => {
    console.error('Could not connect to MongoDB:', err.message);
    process.exit(1);
  });
