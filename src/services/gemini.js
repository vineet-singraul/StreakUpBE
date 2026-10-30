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

async function ask(prompt, fallback) {
  const ai = getClient();
  if (!ai) return fallback;
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
