import mongoose from 'mongoose';
import Task from '../models/Task.js';
import Habit from '../models/Habit.js';
import Report from '../models/Report.js';
import Challenge from '../models/Challenge.js';
import { askGemini, isGeminiConfigured } from './gemini.js';
import { todayStr } from '../utils/date.js';

/**
 * Chatbot flow (2 Gemini calls per message):
 *   1. Gemini reads the user's question + DB schema and writes a MongoDB query plan (JSON).
 *   2. We validate it (read-only, whitelisted collections, ALWAYS scoped to this user) and run it.
 *   3. Gemini turns the result rows into a natural-language answer.
 */

// Only these collections are reachable from the chatbot. Users / locations are never exposed.
const COLLECTIONS = {
  tasks: Task,
  habits: Habit,
  reports: Report,
  challenges: Challenge,
};

const SCHEMA = `
tasks       { date: "YYYY-MM-DD", title: String, done: Boolean, doneAt: Date, estimateMinutes: Number, timeSpent: Number (seconds), createdAt: Date }
            -> one document per daily task.
habits      { month: "YYYY-MM", name: String, completedDates: ["YYYY-MM-DD", ...] }
            -> a monthly habit; each tick is a date string in completedDates. Days done = size of completedDates.
reports     { date: "YYYY-MM-DD", total: Number, completedCount: Number, completed: [String], pending: [{ title, reason }], aiSummary: String, final: Boolean, aiFeedback: String }
            -> one daily report per day (final=true after the day ended).
challenges  { title: String, startDate: "YYYY-MM-DD", days: Number, active: Boolean, endedAt: "YYYY-MM-DD", items: [{ name: String, doneDays: [Number 1..days] }] }
            -> multi-day challenge; doneDays are day numbers counted from startDate (day 1 = startDate).
`.trim();

// Anything that could write data, run JS, or read other collections is rejected.
const FORBIDDEN_KEYS = new Set([
  '$where', '$function', '$accumulator', '$lookup', '$graphLookup', '$unionWith', '$out', '$merge',
  '$currentOp', '$listSessions', '$listLocalSessions', '$collStats', '$indexStats', '$planCacheStats',
  '$documents', '$changeStream', '$listSearchIndexes', '$search', '$searchMeta', '$vectorSearch',
]);

const MAX_FIND_LIMIT = 50;
const MAX_AGG_RESULTS = 100;
const MAX_HISTORY = 6;

class UnsafeQueryError extends Error {}

/** Recursively reject forbidden operators and any attempt to touch the `user` field */
function assertSafe(value, depth = 0) {
  if (depth > 30) throw new UnsafeQueryError('Query too deep');
  if (Array.isArray(value)) return value.forEach((v) => assertSafe(v, depth + 1));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) throw new UnsafeQueryError(`Operator ${k} is not allowed`);
      if (k === 'user' || k.startsWith('user.')) throw new UnsafeQueryError('The user field cannot be queried');
      assertSafe(v, depth + 1);
    }
  } else if (typeof value === 'string' && /^\$\$(USER_ROLES|CLUSTER_TIME|SEARCH_META)/.test(value)) {
    throw new UnsafeQueryError(`Variable ${value} not allowed`);
  }
}

/** Gemini writes dates as {"$date": "..."}; turn those into real Date objects */
function reviveDates(value) {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$date') {
      const d = new Date(value.$date);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveDates(v)]));
  }
  return value;
}

function parseJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

const LANGUAGE_NAMES = {
  en: 'simple English',
  hi: 'Hindi (Devanagari script)',
  hinglish: 'Hinglish (Hindi written in Roman script, mixed with English)',
};

function historyText(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY)
    .filter((m) => m && typeof m.text === 'string')
    .map((m) => `${m.role === 'bot' ? 'Assistant' : 'User'}: ${m.text.slice(0, 400)}`)
    .join('\n');
}

/** Step 1: natural language -> query plan */
async function planQuery({ message, history, language }) {
  const today = todayStr();
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', weekday: 'long' }).format(new Date());

  const prompt = `You convert a user's question about their OWN habit-tracker data into a read-only MongoDB query.
Today is ${today} (${weekday}). Dates are stored as "YYYY-MM-DD" strings, months as "YYYY-MM", so compare them as strings ($gte/$lte work).

Collections (the current user's filter is added automatically — NEVER mention the "user" field):
${SCHEMA}

Previous conversation (for follow-up questions):
${historyText(history) || '(none)'}

User question: ${JSON.stringify(message)}

Reply with ONLY one JSON object, no markdown, in one of these shapes:
1. Data needed, simple lookup:
   {"needsData": true, "collection": "tasks|habits|reports|challenges", "operation": "find", "filter": {...}, "projection": {...} | null, "sort": {...} | null, "limit": <1-${MAX_FIND_LIMIT}>, "explain": "<one short line what this query fetches>"}
2. Data needed, counting:
   {"needsData": true, "collection": "...", "operation": "count", "filter": {...}, "explain": "..."}
3. Data needed, grouping / sums / averages / percentages:
   {"needsData": true, "collection": "...", "operation": "aggregate", "pipeline": [ ...stages... ], "explain": "..."}
4. No data needed (greeting, general advice, question outside the app's data):
   {"needsData": false, "reply": "<short helpful answer in ${LANGUAGE_NAMES[language] || 'Hinglish'}; you can only read their data, never offer to change it; start with one fitting emoji, e.g. 👋 greeting, 💡 tip, 🙂 general>"}

Rules:
- Read-only. Allowed stages: $match, $project, $addFields, $set, $unwind, $group, $sort, $limit, $skip, $count, $facet, $bucket, $sortByCount, $unset, $replaceRoot.
- Never use $lookup, $where, $function, $out, $merge.
- For Date fields (doneAt, createdAt) write dates as {"$date": "2026-11-01T00:00:00+05:30"}.
- Use case-insensitive regex for name/title matching: {"title": {"$regex": "gym", "$options": "i"}}.
- "this week" = Monday of this week to today; "last 7 days" = 6 days before today to today.`;

  return parseJson(await askGemini(prompt, ''));
}

/** Step 2: validate + run the plan, always scoped to this user */
async function runPlan(plan, userId) {
  const Model = COLLECTIONS[plan.collection];
  if (!Model) throw new UnsafeQueryError(`Unknown collection "${plan.collection}"`);
  const uid = new mongoose.Types.ObjectId(userId);
  const opts = { maxTimeMS: 5000 };

  if (plan.operation === 'find' || plan.operation === 'count') {
    const filter = plan.filter && typeof plan.filter === 'object' ? plan.filter : {};
    assertSafe(filter);
    const scoped = { $and: [{ user: uid }, reviveDates(filter)] };

    if (plan.operation === 'count') {
      const count = await Model.countDocuments(scoped).maxTimeMS(opts.maxTimeMS);
      return { count };
    }

    let projection = plan.projection && typeof plan.projection === 'object' ? plan.projection : null;
    if (projection) assertSafe(projection);
    const sort = plan.sort && typeof plan.sort === 'object' ? plan.sort : { date: -1, createdAt: -1 };
    assertSafe(sort);
    const limit = Math.min(Math.max(Number(plan.limit) || 20, 1), MAX_FIND_LIMIT);

    // Only inclusion projections are reliable to merge; always drop internals
    if (projection && Object.values(projection).some((v) => v === 1 || v === true)) {
      projection = { ...projection, _id: 0 };
    } else {
      projection = { ...(projection || {}), user: 0, __v: 0, _id: 0 };
    }
    return Model.find(scoped, projection).sort(sort).limit(limit).maxTimeMS(opts.maxTimeMS).lean();
  }

  if (plan.operation === 'aggregate') {
    if (!Array.isArray(plan.pipeline)) throw new UnsafeQueryError('Pipeline must be an array');
    assertSafe(plan.pipeline);
    const pipeline = [
      { $match: { user: uid } }, // first stage: nothing from other users can ever enter
      ...reviveDates(plan.pipeline),
      { $limit: MAX_AGG_RESULTS },
      { $unset: ['user', '__v'] },
    ];
    return Model.aggregate(pipeline).option(opts);
  }

  throw new UnsafeQueryError(`Unknown operation "${plan.operation}"`);
}

/** Step 3: rows -> friendly answer */
async function writeAnswer({ message, plan, rows, name, language }) {
  let data = JSON.stringify(rows);
  if (data.length > 12000) data = `${data.slice(0, 12000)}... (truncated)`;
  const count = Array.isArray(rows) ? rows.length : null;

  // Used when Gemini is unavailable: still shows status emojis per row
  const mark = (r) => (r.done === true ? '✅' : r.done === false ? '⏳' : '📌');
  const fallback = Array.isArray(rows)
    ? (rows.length
      ? `📊 ${rows.length} records mile:\n${rows.slice(0, 10).map((r) => `${mark(r)} ${r.title || r.name || r.date || JSON.stringify(r).slice(0, 80)}`).join('\n')}`
      : '🤔 Is sawaal ke liye koi data nahi mila.')
    : `📊 Result: ${data}`;

  const prompt = `You are a friendly assistant inside a habit tracker app, answering ${name}'s question about their own data.
Today is ${todayStr()}.
Question: ${JSON.stringify(message)}
Query that was run: ${plan.explain || plan.operation} (collection: ${plan.collection})
Result${count != null ? ` (${count} rows)` : ''}: ${data}

Answer in ${LANGUAGE_NAMES[language] || 'Hinglish'}. Use ONLY the result data; if it is empty, say no matching data was found and suggest what they could do.
You can only READ data: never offer to add, edit or delete anything. Be short and clear (under 120 words). No markdown headings, no asterisks, no JSON. timeSpent is in seconds — convert to minutes. Dates like "2026-11-05" should be written as "5 Nov".

Emojis — pick them from the situation in the data (2-4 per answer, never random):
- Start with ONE emoji that matches the overall result: 🎉 all done / 100%, 💪 good progress (50-99%), 😕 or 🙂 low progress (<50%) with encouragement, 🤔 no data found, 🔥 streaks, 📊 numbers / percentages, 📅 dates / schedules, 🏆 challenges or rewards.
- List lines start with a status emoji instead of a plain bullet: ✅ done / completed item, ⏳ pending / not done item, ❌ missed day, 📌 neutral item.
- End with at most one short motivating line with a fitting emoji (🚀, 🌱, ⭐) only when it adds value.`;

  return askGemini(prompt, fallback);
}

// ---- Guarantee every reply opens with an emoji (Gemini sometimes skips it, esp. for small talk) ----
const LEADING_EMOJI = /^\s*(\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
function withEmoji(text, emoji) {
  const s = String(text || '').trim();
  return LEADING_EMOJI.test(s) ? s : `${emoji} ${s}`;
}
// Pick an emoji for messages that don't need data (greetings, thanks, etc.)
function smallTalkEmoji(message) {
  const m = message.toLowerCase();
  if (/\b(hi+|hello|hey|hlo|helo|namaste|namaskar|salaam|good\s*(morning|afternoon|evening|night))\b|नमस्ते|हेलो/.test(m)) return '👋';
  if (/\b(thanks?|thank\s*you|thx|shukriya|dhanyavaad|dhanyawad)\b|धन्यवाद|शुक्रिया/.test(m)) return '😊';
  if (/\b(bye|good\s*bye|see\s*you|tata|alvida)\b/.test(m)) return '👋';
  if (/\b(how are you|kaise ho|kaisa hai|kya haal)\b/.test(m)) return '😄';
  if (/\b(tip|advice|suggest|motivat|help|kaise|how to)\b/.test(m)) return '💡';
  return '🙂';
}

export async function chat({ userId, name, language, message, history }) {
  if (!isGeminiConfigured()) {
    return { answer: '⚠️ Chatbot ke liye GEMINI_API_KEY set karna zaroori hai (Backend/.env).', query: null };
  }

  const plan = await planQuery({ message, history, language });
  if (!plan) {
    return { answer: '😅 Sorry, abhi samajh nahi paya ya AI limit khatam ho gayi. Thoda alag tarike se poochho ya baad me try karo.', query: null };
  }

  if (!plan.needsData) {
    const reply = String(plan.reply || 'Main aapke tasks, habits, reports aur challenges ke baare me bata sakta hoon. Kuch poochho!');
    return { answer: withEmoji(reply, smallTalkEmoji(message)), query: null };
  }

  const query = {
    collection: plan.collection,
    operation: plan.operation,
    ...(plan.operation === 'aggregate' ? { pipeline: plan.pipeline } : { filter: plan.filter || {} }),
    ...(plan.sort ? { sort: plan.sort } : {}),
    ...(plan.limit ? { limit: plan.limit } : {}),
    explain: plan.explain,
  };

  let rows;
  try {
    rows = await runPlan(plan, userId);
  } catch (err) {
    if (err instanceof UnsafeQueryError) {
      console.warn('Chatbot rejected query:', err.message, JSON.stringify(plan).slice(0, 300));
      return { answer: '🙏 Ye sawaal main safely data me convert nahi kar paya. Thoda simple tarike se poochho, jaise "aaj ke pending tasks dikhao".', query };
    }
    console.error('Chatbot query failed:', err.message);
    return { answer: '⚠️ Data laate waqt error aa gaya. Sawaal thoda badal kar poochho.', query };
  }

  const answer = await writeAnswer({ message, plan, rows, name, language });
  const empty = Array.isArray(rows) ? rows.length === 0 : rows?.count === 0;
  return { answer: withEmoji(answer, empty ? '🤔' : '📊'), query, resultCount: Array.isArray(rows) ? rows.length : 1 };
}
