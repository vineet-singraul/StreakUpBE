import cron from 'node-cron';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { buildDailyReport, dailyStats } from './report.js';
import { sendMail, reminderEmail, reportEmail, noTasksEmail } from './mailer.js';
import { sendPush } from './push.js';
import { todayStr, yesterdayStr, prettyDate } from '../utils/date.js';

/** 12 AM: final report for the day that just ended, emailed + pushed, asks for reasons */
export async function runMidnightReports(date = yesterdayStr()) {
  // Every user gets the 12 AM mail; those without tasks get a short "add tasks today" note
  const users = await User.find({});
  console.log(`[report] ${date}: sending to ${users.length} user(s)`);

  for (const user of users) {
    const userId = user._id;
    try {
      const report = await buildDailyReport(userId, date, { final: true });
      const dateLabel = prettyDate(date);
      if (!report) {
        await sendMail({ to: user.email, subject: `📊 ${dateLabel}: koi task nahi tha`, html: noTasksEmail({ name: user.name, dateLabel }) });
        await sendPush(user, { title: '📝 Aaj ke tasks add karo', body: 'Kal koi task nahi tha. Aaj ka plan abhi likh lo!', url: '/day/today' });
        continue;
      }

      const week = await dailyStats(userId, date, 7);
      // The report is always pushed too, so it still reaches the user if the email fails
      await sendMail({
        to: user.email,
        subject: `📊 Daily Report ${dateLabel}: ${report.completedCount}/${report.total} done`,
        html: reportEmail({ name: user.name, dateLabel, report, week }),
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

  // Users who haven't added anything today get a push nudge (no email, to avoid hourly spam)
  if (!onlyUserId) {
    const noTasks = await User.find({ _id: { $nin: [...byUser.values()].map((g) => g._id) }, pushReminders: true, 'pushSubscriptions.0': { $exists: true } });
    for (const user of noTasks) {
      await sendPush(user, { title: '📝 Aaj ke tasks add karo', body: 'Abhi tak aaj ka koi task nahi hai. 1 minute me plan likh lo!', url: '/day/today' }).catch(() => {});
    }
    if (noTasks.length) console.log(`[reminder] nudged ${noTasks.length} user(s) without tasks`);
  }

  console.log(`[reminder] ${date}: ${groups.length} user(s) with pending tasks`);

  const stats = { users: groups.length, pushed: 0, mailed: 0, fallbackPushed: 0 };
  for (const g of groups) {
    try {
      const user = await User.findById(g._id);
      if (!user) continue;
      const payload = {
        title: `⏰ ${g.pending.length} task pending hai!`,
        body: g.pending.slice(0, 3).join(', ') + (g.pending.length > 3 ? '...' : ''),
        url: `/day/${date}`,
      };

      let pushed = user.pushReminders ? await sendPush(user, payload) : 0;
      const mailed = user.emailReminders
        ? await sendMail({
          to: user.email,
          subject: `⏰ Reminder: ${g.pending.length} task(s) abhi baaki hain`,
          html: reminderEmail({ name: user.name.split(' ')[0], pending: g.pending, done: g.done, total: g.total }),
        })
        : false;

      // Email failed (or is off) and nothing reached the user yet: browser notification is the fallback
      if (!mailed && !pushed) {
        pushed = await sendPush(user, payload);
        if (pushed) stats.fallbackPushed += 1;
      }
      if (pushed) stats.pushed += 1;
      if (mailed) stats.mailed += 1;
    } catch (err) {
      console.error('[reminder] failed for user', String(g._id), err.message);
    }
  }
  console.log(`[reminder] push=${stats.pushed} email=${stats.mailed} fallback-push=${stats.fallbackPushed}`);
  return stats;
}

export function startScheduler() {
  const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
  const reportCron = process.env.REPORT_CRON || '0 0 * * *';
  const reminderCron = process.env.REMINDER_CRON || '0 8-22 * * *';

  cron.schedule(reportCron, () => runMidnightReports().catch(console.error), { timezone });
  cron.schedule(reminderCron, () => runReminders().catch(console.error), { timezone });

  console.log(`Scheduler started (${timezone}) report="${reportCron}" reminders="${reminderCron}"`);
}
