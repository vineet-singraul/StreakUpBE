import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
      // Fail fast (e.g. host blocks SMTP) so the browser-notification fallback kicks in quickly
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

// Checked once at startup so /api/health shows whether this host can reach Gmail (some block SMTP)
export let mailStatus = 'not checked';
export async function checkMail() {
  if (process.env.BREVO_API_KEY) return (mailStatus = 'ok (brevo api)');
  const t = getTransporter();
  if (!t) return (mailStatus = 'GMAIL_USER / GMAIL_APP_PASSWORD missing');
  try {
    await t.verify();
    mailStatus = 'ok';
  } catch (err) {
    mailStatus = `failed: ${err.code || err.message}`;
  }
  console.log('Gmail SMTP:', mailStatus);
  return mailStatus;
}

async function sendViaBrevo({ to, subject, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Habit Tracker', email: process.env.MAIL_FROM || process.env.GMAIL_USER },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendMail({ to, subject, html }) {
  if (process.env.BREVO_API_KEY) {
    try {
      return await sendViaBrevo({ to, subject, html });
    } catch (err) {
      console.error('Email send failed:', err.message);
      return false;
    }
  }
  const t = getTransporter();
  if (!t) {
    console.warn('Gmail not configured, skipping email to', to);
    return false;
  }
  try {
    await t.sendMail({ from: `"Habit Tracker" <${process.env.GMAIL_USER}>`, to, subject, html });
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, body) {
  const url = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;background:#f6f7fb">
  <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e6e8f0">
    <h2 style="margin:0 0 12px;color:#4f46e5">${escape(title)}</h2>
    ${body}
    <p style="margin-top:24px"><a href="${url}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open Habit Tracker</a></p>
  </div></div>`;
}

const list = (items) => `<ul>${items.map((t) => `<li>${escape(t)}</li>`).join('')}</ul>`;

export function reminderEmail({ name, pending, done, total }) {
  return layout(
    `${name}, ${pending.length} task${pending.length > 1 ? 's' : ''} abhi baaki hai!`,
    `<p>Aaj ka progress: <b>${done}/${total}</b> complete.</p>
     <p>Ye tasks abhi pending hain:</p>${list(pending)}
     <p>Chalo, abhi ek task complete karo 💪</p>`,
  );
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Completion % per day as an email-safe (table based) column chart */
function weekChart(days) {
  if (!days?.length) return '';
  const H = 110;
  const cols = days
    .map((d) => {
      const pct = d.total ? Math.round((d.done / d.total) * 100) : null;
      const barH = pct === null ? 0 : Math.max(Math.round((pct / 100) * H), 3);
      return `<td valign="bottom" align="center" style="padding:0 4px;width:${Math.floor(100 / days.length)}%">
        <div style="font-size:11px;color:#52514e;margin-bottom:4px">${pct === null ? '–' : `${pct}%`}</div>
        <div style="height:${barH}px;width:22px;max-width:100%;background:#4f46e5;border-radius:4px 4px 0 0;margin:0 auto"></div>
      </td>`;
    })
    .join('');
  const labels = days
    .map((d) => {
      const [y, m, day] = d.date.split('-').map(Number);
      const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
      return `<td align="center" style="font-size:11px;color:#52514e;padding-top:6px">${wd}<br>${day}</td>`;
    })
    .join('');
  return `<h4 style="margin:20px 0 8px">📊 Last 7 days: task completion</h4>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid #e6e8f0;height:${H + 24}px">
      <tr>${cols}</tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${labels}</tr></table>`;
}

export function noTasksEmail({ name, dateLabel }) {
  return layout(
    `${dateLabel}: koi task nahi tha`,
    `<p>Hi ${escape(name)}, kal aapne koi task add nahi kiya tha, isliye report khaali hai.</p>
     <p>Aaj subah hi apne tasks likh lo. Har ghante reminder aayega aur raat 12 baje AI report banegi 💪</p>`,
  );
}

export function reportEmail({ name, dateLabel, report, week }) {
  const askReasons = report.pending.length
    ? `<p style="color:#b45309"><b>Ye tasks kyon nahi ho paaye?</b> App kholkar reason batao, AI aapko kal ke liye plan dega.</p>`
    : '';
  return layout(
    `Daily Report - ${dateLabel}`,
    `<p>Hi ${escape(name)}, aapne <b>${report.completedCount}/${report.total}</b> tasks complete kiye.</p>
     <h4 style="margin-bottom:4px">✅ Completed</h4>${list(report.completed.length ? report.completed : ['(none)'])}
     <h4 style="margin-bottom:4px">❌ Pending</h4>${list(report.pending.length ? report.pending.map((p) => p.title) : ['(none)'])}
     <h4 style="margin-bottom:4px">🤖 AI Report</h4>
     <div style="white-space:pre-wrap;background:#f3f4ff;padding:12px;border-radius:8px">${escape(report.aiSummary)}</div>
     ${weekChart(week)}
     ${askReasons}`,
  );
}
