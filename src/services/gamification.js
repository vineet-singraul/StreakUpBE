// Gamification is DERIVED from habit data — never stored — so XP/streaks can't drift out of sync.
// XP model: every habit tick = 10 XP, plus a small daily bonus for keeping a streak alive.
import { todayStr, addDays } from '../utils/date.js';

const XP_PER_TICK = 10;
const STREAK_DAY_BONUS = 5; // extra XP per day the user completed at least one habit

// Levels grow ~quadratically: level N needs 50 * N * (N-1) XP in total.
export function levelFromXp(xp) {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level += 1;
  const curFloor = 50 * level * (level - 1);
  const nextFloor = 50 * (level + 1) * level;
  return { level, xpInLevel: xp - curFloor, xpForNext: nextFloor - curFloor, nextLevelXp: nextFloor };
}

// Current streak = consecutive days up to today (or yesterday) with >=1 completion.
function streaks(activeDays) {
  const set = new Set(activeDays);
  const today = todayStr();
  // Streak stays alive if today OR yesterday was active (today may just not be done yet)
  let cursor = set.has(today) ? today : set.has(addDays(today, -1)) ? addDays(today, -1) : null;
  let current = 0;
  while (cursor && set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  // Longest streak across all active days
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  return { current, longest };
}

const BADGES = [
  { id: 'first-step', icon: '👣', name: 'First Step', desc: 'Pehli habit complete ki', test: (s) => s.totalTicks >= 1 },
  { id: 'getting-started', icon: '🌱', name: 'Getting Started', desc: '10 completions', test: (s) => s.totalTicks >= 10 },
  { id: 'half-century', icon: '⭐', name: 'Half Century', desc: '50 completions', test: (s) => s.totalTicks >= 50 },
  { id: 'centurion', icon: '💯', name: 'Centurion', desc: '100 completions', test: (s) => s.totalTicks >= 100 },
  { id: 'streak-3', icon: '🔥', name: 'On Fire', desc: '3-day streak', test: (s) => s.longest >= 3 },
  { id: 'streak-7', icon: '🔥', name: 'Week Warrior', desc: '7-day streak', test: (s) => s.longest >= 7 },
  { id: 'streak-30', icon: '🏆', name: 'Unstoppable', desc: '30-day streak', test: (s) => s.longest >= 30 },
  { id: 'level-5', icon: '🎖️', name: 'Rising Star', desc: 'Level 5 reached', test: (s) => s.level >= 5 },
  { id: 'level-10', icon: '👑', name: 'Habit Master', desc: 'Level 10 reached', test: (s) => s.level >= 10 },
  { id: 'collector', icon: '📚', name: 'Collector', desc: '5+ habits banayi', test: (s) => s.habitCount >= 5 },
];

/** habits: lean docs with { completedDates: [YYYY-MM-DD] }. Returns the full gamification profile. */
export function computeProfile(habits) {
  const perDay = new Map(); // date -> completions that day
  let totalTicks = 0;
  for (const h of habits) {
    for (const d of h.completedDates || []) {
      perDay.set(d, (perDay.get(d) || 0) + 1);
      totalTicks += 1;
    }
  }
  const activeDays = [...perDay.keys()];
  const { current, longest } = streaks(activeDays);
  const xp = totalTicks * XP_PER_TICK + activeDays.length * STREAK_DAY_BONUS;
  const lvl = levelFromXp(xp);

  const stats = { totalTicks, habitCount: habits.length, activeDays: activeDays.length, current, longest, level: lvl.level };
  const badges = BADGES.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: b.test(stats) }));

  return {
    xp,
    ...lvl,
    streak: { current, longest },
    totals: { completions: totalTicks, habits: habits.length, activeDays: activeDays.length },
    badges,
    earnedCount: badges.filter((b) => b.earned).length,
  };
}
