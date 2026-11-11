import { GoogleGenAI } from '@google/genai';
import { prettyDate } from '../utils/date.js';

let client = null;

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith('PASTE_')) return null;
  // Never let a slow/overloaded model hang a request or the midnight job
  if (!client) client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 60000 } });
  return client;
}

// GEMINI_MODEL may list fallbacks: "gemini-3.5-flash-lite,gemini-3.8-flash"
const models = () => (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').split(',').map((m) => m.trim()).filter(Boolean);

export function isGeminiConfigured() {
  return Boolean(getClient());
}

// ---- Free-tier guard: space calls out (GEMINI_RPM) and stop at a daily budget (GEMINI_DAILY_LIMIT).
// Past the budget every caller simply gets its fallback text, so nothing breaks or bills.
const usage = { day: '', calls: 0, skipped: 0 };
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const istDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());

export function geminiUsage() {
  return { ...usage, limit: Number(process.env.GEMINI_DAILY_LIMIT) || 900 };
}

async function takeSlot() {
  const today = istDay();
  if (usage.day !== today) Object.assign(usage, { day: today, calls: 0, skipped: 0 });
  if (usage.calls >= (Number(process.env.GEMINI_DAILY_LIMIT) || 900)) {
    usage.skipped += 1;
    return false;
  }
  usage.calls += 1;
  const gap = 60000 / (Number(process.env.GEMINI_RPM) || 10);
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Math.max(nextSlot, Date.now()) + gap;
  if (wait) await sleep(wait);
  return true;
}

async function ask(prompt, fallback) {
  const ai = getClient();
  if (!ai) return fallback;
  if (!(await takeSlot())) return fallback;
  for (const model of models()) {
    try {
      const res = await ai.models.generateContent({ model, contents: prompt });
      const text = res.text?.trim();
      if (text) return text;
    } catch (err) {
      console.error(`Gemini error (${model}):`, err.status || '', String(err.message).slice(0, 200));
    }
  }
  return fallback;
}

// Shared with the chatbot service (same rate limit / daily budget / model fallbacks)
export { ask as askGemini };

const LANGUAGE_NAMES = {
  en: 'simple English',
  hi: 'Hindi (Devanagari script)',
  hinglish: 'Hinglish (Hindi written in Roman script, mixed with English)',
};
// Per-user language; REPORT_LANGUAGE is only the fallback for users who never picked one
const langName = (code) => LANGUAGE_NAMES[code] || process.env.REPORT_LANGUAGE || 'Hinglish';
const bullet = (items) => (items.length ? items.map((t) => `- ${t}`).join('\n') : '- (none)');

export function dailySummary({ name, date, completed, pending, final, language }) {
  const lang = () => langName(language);
  const total = completed.length + pending.length;
  const pct = total ? Math.round((completed.length / total) * 100) : 0;

  const fallback = [
    `Report for ${prettyDate(date)}`,
    `Completed ${completed.length}/${total} tasks (${pct}%).`,
    '',
    'Done:',
    bullet(completed),
    '',
    'Pending:',
    bullet(pending),
    '',
    pending.length
      ? 'Tip: Kal ke liye sabse important 3 tasks pehle subah hi complete karo.'
      : 'Shabash! Saare tasks complete ho gaye.',
  ].join('\n');

  const prompt = `You are a friendly, honest productivity coach inside a habit tracker app.
Write a short daily report in ${lang()} for ${name} for ${prettyDate(date)}.
${final ? 'The day is over.' : 'The day is still in progress.'}

Completed tasks (${completed.length}):
${bullet(completed)}

Pending / not completed tasks (${pending.length}):
${bullet(pending)}

Completion: ${completed.length}/${total} (${pct}%).

Format (plain text, no markdown headings, no asterisks):
1. One line score summary with an emoji.
2. "Done:" list and "Pending:" list.
3. 2-3 lines of insight about the pattern (what kind of tasks got skipped).
4. 3 concrete, practical tips for tomorrow.
Keep it under 180 words and motivating, not preachy.`;

  return ask(prompt, fallback);
}

export function reasonsFeedback({ name, date, items, language }) {
  const lang = () => langName(language);
  const lines = items.map((i) => `- ${i.title}: ${i.reason || '(no reason given)'}`).join('\n');
  const fallback = 'Reasons save ho gaye. Kal in tasks ko chhote steps me todkar subah hi shuru karo, aur har ghante wale reminders pe dhyan do.';

  const prompt = `You are a supportive productivity coach in a habit tracker app.
${name} could not complete these tasks on ${prettyDate(date)}, with their reasons:
${lines}

In ${lang()}, reply in plain text (no markdown, no asterisks), under 150 words:
- Briefly acknowledge the reasons without judging.
- Identify the root pattern (time management, over-planning, energy, distraction, etc.).
- Give one specific fix per task or per reason.
- End with one motivating line for tomorrow.`;

  return ask(prompt, fallback);
}

/**
 * A fresh push-notification line for every reminder, written by Gemini about one specific task.
 * state: 'pending' | 'none' (no tasks today) | 'done' (all tasks done). Returns { title, body }.
 */
export async function notificationLine({ name, language, state, pending = [], done = 0, total = 0, fallback }) {
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date());
  // rotate which pending task the line is about, so each reminder talks about something different
  const focus = pending.length ? pending[Math.floor(Date.now() / (30 * 60 * 1000)) % pending.length] : null;
  const situation = {
    pending: `${name} has done ${done}/${total} tasks today. Still pending: ${pending.join('; ')}. Write about this one task specifically: "${focus}".`,
    none: `${name} has not added any task for today yet. Nudge them to plan the day and add tasks.`,
    done: `${name} finished all ${total} tasks today. Celebrate and suggest one small bonus thing (rest, reflect, plan tomorrow).`,
  }[state];

  const prompt = `You write short phone push notifications for a habit tracker app. Current time: ${time}.
${situation}
Write in ${langName(language)}. Be specific, warm and energetic, a little witty, never preachy. Vary wording every time; use 1 fitting emoji.
Reply with ONLY JSON: {"title": "<max 45 chars>", "body": "<max 110 chars>"}`;

  const raw = await ask(prompt, '');
  try {
    const json = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim());
    if (json.title && json.body) return { title: String(json.title).slice(0, 60), body: String(json.body).slice(0, 140) };
  } catch {
    /* fall back below */
  }
  return fallback;
}

/**
 * One Gemini call writes notifications for up to ~20 users at once (keeps free-tier usage tiny).
 * entries: [{ id, name, language, state, focus, done, total }] -> Map(id -> { title, body })
 */
export async function notificationLinesBatch(entries) {
  if (!entries.length) return new Map();
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date());
  const people = entries.map((e) => ({
    id: e.id,
    name: e.name,
    language: langName(e.language),
    situation: e.state === 'pending'
      ? `done ${e.done}/${e.total} tasks; write about this pending task: "${e.focus}"`
      : e.state === 'done' ? `finished all ${e.total} tasks today; celebrate, suggest a small bonus (rest/plan tomorrow)`
        : 'has not added any task today; nudge them to plan the day',
  }));
  const prompt = `You write short phone push notifications for a habit tracker app. Current time: ${time}.
For EACH person below write one notification in THAT person's language. Specific, warm, energetic, a little witty, never preachy, 1 fitting emoji, no two alike.
People: ${JSON.stringify(people)}
Reply with ONLY a JSON array: [{"id": "<id>", "title": "<max 45 chars>", "body": "<max 110 chars>"}]`;

  const raw = await ask(prompt, '');
  const out = new Map();
  try {
    const arr = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim());
    for (const r of Array.isArray(arr) ? arr : []) {
      if (r?.id && r.title && r.body) out.set(String(r.id), { title: String(r.title).slice(0, 60), body: String(r.body).slice(0, 140) });
    }
  } catch {
    /* callers fall back to templates for anyone missing */
  }
  return out;
}
