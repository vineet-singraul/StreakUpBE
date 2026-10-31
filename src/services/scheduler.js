import cron from 'node-cron';
import Task from '../models/Task.js';
import User from '../models/User.js';
import Report from '../models/Report.js';
import { buildDailyReport, dailyStats } from './report.js';
import { sendMail, reminderEmail, reportEmail } from './mailer.js';
import { sendPush } from './push.js';
import { notificationLinesBatch } from './gemini.js';
import { templateLine } from './notifyTemplates.js';
import { todayStr, yesterdayStr, prettyDate, addDays } from '../utils/date.js';

const TZ = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';
const istHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ(), hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const istMinute = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ(), minute: '2-digit' }).format(new Date()));

// Gemini writes the notifications only at these IST hours (on the :00 run); every other run uses templates.
// Batched 20 users per call, so 1000 users = 50 calls per slot.
const AI_HOURS = () => (process.env.AI_NOTIFY_HOURS || '9,13,17,21').split(',').map(Number);
const AI_BATCH = 20;

// Shown in /api/health so we can see the jobs are actually firing on the server
export const schedulerInfo = { reminderCron: null, lastReminder: null, lastReport: null };

/** Run fn over items with at most `limit` in flight */
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (err) {
        console.error('[job] item failed:', err.message);
      }
    }
  });
  await Promise.all(workers);
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));
const firstName = (u) => (u.name || 'Friend').split(' ')[0];

/** Every 30 min: one push per user (pending / no tasks / all done). Manual test (onlyUserId) also emails. */
export async function runReminders(onlyUserId = null) {
  const date = todayStr();
  const userFilter = onlyUserId ? { _id: onlyUserId } : { pushReminders: true, 'pushSubscriptions.0': { $exists: true } };
  const users = await User.find(userFilter);
  if (!users.length) return { users: 0, pushed: 0, mailed: 0, ai: false };

  // one query for everyone's tasks today
  const tasks = await Task.find({ date, user: { $in: users.map((u) => u._id) } }).select('user title done').lean();
  const byUser = new Map();
  for (const t of tasks) {
    const g = byUser.get(String(t.user)) || { total: 0, done: 0, pending: [] };
    g.total += 1;
    if (t.done) g.done += 1;
    else g.pending.push(t.title);
    byUser.set(String(t.user), g);
  }

  const slot = Math.floor(Date.now() / (30 * 60 * 1000));
  const entries = users.map((u) => {
    const g = byUser.get(String(u._id)) || { total: 0, done: 0, pending: [] };
    const state = !g.total ? 'none' : g.pending.length ? 'pending' : 'done';
    const focus = g.pending.length ? g.pending[slot % g.pending.length] : '';
    return { user: u, g, state, id: String(u._id), name: firstName(u), language: u.language, focus, done: g.done, total: g.total };
  });

  // AI lines a few times a day, templates otherwise
  const useAI = Boolean(onlyUserId) || (AI_HOURS().includes(istHour()) && istMinute() < 30);
  const lines = new Map();
  if (useAI) {
    await mapLimit(chunk(entries, AI_BATCH), 2, async (batch) => {
      for (const [id, line] of await notificationLinesBatch(batch)) lines.set(id, line);
    });
  }

  const stats = { users: entries.length, pushed: 0, mailed: 0, ai: useAI, aiLines: lines.size };
  await mapLimit(entries, 20, async (e) => {
    const line = lines.get(e.id) || templateLine({ state: e.state, language: e.language, name: e.name, task: e.focus, done: e.done, total: e.total });
    const url = e.state === 'pending' ? `/day/${date}` : '/day/today';
    if (await sendPush(e.user, { ...line, url })) stats.pushed += 1;
    // reminder emails only on a manual test, so free email quotas go to the 12 AM report
    if (onlyUserId && e.user.emailReminders && e.g.pending.length) {
      const ok = await sendMail({
        to: e.user.email,
        subject: `⏰ Reminder: ${e.g.pending.length} task(s) abhi baaki hain`,
        html: reminderEmail({ name: e.name, pending: e.g.pending, done: e.g.done, total: e.g.total }),
      });
      if (ok) stats.mailed += 1;
    }
  });

  console.log(`[reminder] users=${stats.users} pushed=${stats.pushed} ai=${useAI} aiLines=${stats.aiLines}`);
  return stats;
}

/** 12 AM: AI report for everyone who had tasks (email + push), a push nudge for the rest, then cleanup */
export async function runMidnightReports(date = yesterdayStr()) {
  const started = Date.now();
  const activeIds = (await Task.distinct('user', { date })).map(String);
  const users = await User.find({});
  const dateLabel = prettyDate(date);
  let reports = 0;

  // Gemini calls are paced by the limiter in gemini.js; 3 in flight keeps DB + push work overlapping
  await mapLimit(users, 3, async (user) => {
    if (!activeIds.includes(String(user._id))) {
      await sendPush(user, { ...templateLine({ state: 'none', language: user.language, name: firstName(user) }), url: '/day/today' });
      return;
    }
    const report = await buildDailyReport(user._id, date, { final: true });
    if (!report) return;
    reports += 1;
    if (user.emailReminders) {
      const week = await dailyStats(user._id, date, 7);
      await sendMail({
        to: user.email,
        subject: `📊 Daily Report ${dateLabel}: ${report.completedCount}/${report.total} done`,
        html: reportEmail({ name: user.name, dateLabel, report, week }),
      });
    }
    await sendPush(user, {
      title: `📊 ${report.completedCount}/${report.total} done`,
      body: report.pending.length ? `${report.pending.length} task(s) reh gaye. Batao kyon nahi ho paaye?` : 'Shabash! Kal saare tasks complete kiye 🎉',
      url: '/reports',
    });
  });

  // Free MongoDB is 512 MB: keep recent history only (charts use the last 30 days)
  const taskDays = Number(process.env.TASK_RETENTION_DAYS) || 180;
  const reportDays = Number(process.env.REPORT_RETENTION_DAYS) || 60;
  const [t, r] = await Promise.all([
    Task.deleteMany({ date: { $lt: addDays(todayStr(), -taskDays) } }),
    Report.deleteMany({ date: { $lt: addDays(todayStr(), -reportDays) } }),
  ]);

  schedulerInfo.lastReport = { at: new Date().toISOString(), date, users: users.length, reports, seconds: Math.round((Date.now() - started) / 1000), cleaned: { tasks: t.deletedCount, reports: r.deletedCount } };
  console.log('[report]', JSON.stringify(schedulerInfo.lastReport));
}

export function startScheduler() {
  const timezone = TZ();
  const reportCron = process.env.REPORT_CRON || '0 0 * * *';
  // Every 30 minutes (IST :00 and :30), all day. Fixed here on purpose: Render still has an old REMINDER_CRON value.
  const reminderCron = '*/30 * * * *';
  schedulerInfo.reminderCron = reminderCron;

  let reminderRunning = false;
  cron.schedule(reportCron, () => runMidnightReports().catch(console.error), { timezone });
  cron.schedule(reminderCron, async () => {
    if (reminderRunning) return; // never stack runs if one is slow
    reminderRunning = true;
    try {
      const stats = await runReminders();
      schedulerInfo.lastReminder = { at: new Date().toISOString(), ...stats };
    } catch (err) {
      schedulerInfo.lastReminder = { at: new Date().toISOString(), error: err.message };
      console.error(err);
    } finally {
      reminderRunning = false;
    }
  }, { timezone });

  console.log(`Scheduler started (${timezone}) report="${reportCron}" reminders="${reminderCron}" aiHours=${AI_HOURS().join(',')}`);
}
