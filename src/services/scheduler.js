import cron from 'node-cron';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { buildDailyReport } from './report.js';
import { sendMail, reminderEmail, reportEmail } from './mailer.js';
import { sendPush } from './push.js';
import { todayStr, yesterdayStr, prettyDate } from '../utils/date.js';

/** 12 AM: final report for the day that just ended, emailed + pushed, asks for reasons */
export async function runMidnightReports(date = yesterdayStr()) {
  const userIds = await Task.distinct('user', { date });
  console.log(`[report] ${date}: generating for ${userIds.length} user(s)`);

  for (const userId of userIds) {
    try {
      const user = await User.findById(userId);
      if (!user) continue;
      const report = await buildDailyReport(userId, date, { final: true });
      if (!report) continue;

      const dateLabel = prettyDate(date);
      await sendMail({
        to: user.email,
        subject: `📊 Daily Report ${dateLabel}: ${report.completedCount}/${report.total} done`,
        html: reportEmail({ name: user.name, dateLabel, report }),
      });
      await sendPush(user, {
        title: `Daily Report: ${report.completedCount}/${report.total} done`,
        body: report.pending.length
          ? `${report.pending.length} task(s) reh gaye. Batao kyon nahi ho paaye?`
          : 'Shabash! Kal saare tasks complete kiye 🎉',
        url: '/reports',
      });
    } catch (err) {
      console.error('[report] failed for user', String(userId), err.message);
    }
  }
}

/** Every hour: remind users who still have pending tasks today */
export async function runReminders(onlyUserId = null) {
  const date = todayStr();
  const match = { date };
  if (onlyUserId) match.user = onlyUserId;

  const tasks = await Task.find(match).select('user title done').lean();
  const byUser = new Map();
  for (const t of tasks) {
    const key = String(t.user);
    if (!byUser.has(key)) byUser.set(key, { _id: t.user, total: 0, done: 0, pending: [] });
    const g = byUser.get(key);
    g.total += 1;
    if (t.done) g.done += 1;
    else g.pending.push(t.title);
  }
  const groups = [...byUser.values()].filter((g) => g.pending.length);

  console.log(`[reminder] ${date}: ${groups.length} user(s) with pending tasks`);

  for (const g of groups) {
    try {
      const user = await User.findById(g._id);
      if (!user) continue;
      if (user.pushReminders) {
        await sendPush(user, {
          title: `⏰ ${g.pending.length} task pending hai!`,
          body: g.pending.slice(0, 3).join(', ') + (g.pending.length > 3 ? '...' : ''),
          url: `/day/${date}`,
        });
      }
      if (user.emailReminders) {
        await sendMail({
          to: user.email,
          subject: `⏰ Reminder: ${g.pending.length} task(s) abhi baaki hain`,
          html: reminderEmail({ name: user.name.split(' ')[0], pending: g.pending, done: g.done, total: g.total }),
        });
      }
    } catch (err) {
      console.error('[reminder] failed for user', String(g._id), err.message);
    }
  }
  return groups.length;
}

export function startScheduler() {
  const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
  const reportCron = process.env.REPORT_CRON || '0 0 * * *';
  const reminderCron = process.env.REMINDER_CRON || '0 8-22 * * *';

  cron.schedule(reportCron, () => runMidnightReports().catch(console.error), { timezone });
  cron.schedule(reminderCron, () => runReminders().catch(console.error), { timezone });

  console.log(`Scheduler started (${timezone}) report="${reportCron}" reminders="${reminderCron}"`);
}
