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

export async function sendMail({ to, subject, html }) {
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

export function reportEmail({ name, dateLabel, report }) {
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
     ${askReasons}`,
  );
}
