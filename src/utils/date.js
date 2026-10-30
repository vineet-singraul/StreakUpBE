const TZ = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-\d{2}$/;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** YYYY-MM-DD in the app timezone */
export function dateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export const todayStr = () => dateStr();
// Midnight job runs at ~00:00, so 12h back is safely "the day that just ended"
export const yesterdayStr = () => dateStr(new Date(Date.now() - 12 * 60 * 60 * 1000));
export const currentMonth = () => todayStr().slice(0, 7);

export function hourNow() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ(), hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

export function calendarBounds() {
  return {
    start: process.env.CALENDAR_START || '2026-10',
    end: process.env.CALENDAR_END || '2027-12',
  };
}

export function isMonthUnlocked(month) {
  const { start, end } = calendarBounds();
  return month >= start && month <= end && month <= currentMonth();
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function listCalendarMonths() {
  const { start, end } = calendarBounds();
  const now = currentMonth();
  let [y, m] = start.split('-').map(Number);
  const months = [];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > end) break;
    months.push({
      key,
      year: y,
      month: m,
      label: monthLabel(key),
      locked: key > now,
      current: key === now,
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

/** YYYY-MM-DD shifted by n days (pure calendar math, no timezone drift) */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The `count` dates ending at `end` (inclusive), oldest first */
export function lastNDays(end, count) {
  return Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));
}

export function prettyDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}
