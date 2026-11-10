// Calendar dates as "YYYY-MM-DD" strings, computed in UTC so the result never
// depends on the phone's time zone. "Today" is passed in by the caller.

export type IsoDate = string

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function fromIso(s: IsoDate): Date {
  return new Date(`${s}T00:00:00Z`)
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** The date in a month with the given day, clamped to the month's length (31 → 28 Feb). */
export function dayInMonth(year: number, month0: number, day: number): IsoDate {
  const y = year + Math.floor(month0 / 12)
  const m = ((month0 % 12) + 12) % 12
  return toIso(new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m)))))
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = fromIso(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000)
}

/** Today's date in Warsaw (or another zone), as YYYY-MM-DD. */
export function todayIn(timeZone = 'Europe/Warsaw', now = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
}

export interface Period {
  /** First day, inclusive. */
  start: IsoDate
  /** Last day, inclusive. */
  end: IsoDate
}

/** How close (in days) a pressed "payday" must be to the usual start day to replace it. */
export const PAYDAY_WINDOW_DAYS = 15

/**
 * Every day a budget month starts, from `from` to `to` (inclusive, roughly):
 * the usual `startDay` of each month, except where a payday was marked within
 * 15 days of it (salary early or late), in which case the marked day wins.
 */
export function periodStarts(
  startDay: number,
  paydays: readonly IsoDate[],
  from: IsoDate,
  to: IsoDate,
): IsoDate[] {
  const f = fromIso(from)
  const t = fromIso(to)
  paydays = onePerMonth(paydays)
  const starts = new Set<IsoDate>(paydays)
  const months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth()
  for (let m = -1; m <= months + 1; m++) {
    const usual = dayInMonth(f.getUTCFullYear(), f.getUTCMonth() + m, startDay)
    const replaced = paydays.some((p) => Math.abs(daysBetween(usual, p)) <= PAYDAY_WINDOW_DAYS)
    if (!replaced) starts.add(usual)
  }
  return [...starts].sort()
}

/**
 * Keeps one payday per budget month: of paydays within 15 days of each other,
 * the earliest wins. The database already refuses a second one (mark_payday);
 * this guards against two presses that slipped through anyway.
 */
export function onePerMonth(paydays: readonly IsoDate[]): IsoDate[] {
  const kept: IsoDate[] = []
  for (const p of [...new Set(paydays)].sort()) {
    const last = kept.at(-1)
    if (!last || daysBetween(last, p) > PAYDAY_WINDOW_DAYS) kept.push(p)
  }
  return kept
}

/** The payday already marked within 15 days of `date`, if any. */
export function paydayNear(paydays: readonly IsoDate[], date: IsoDate): IsoDate | undefined {
  return paydays
    .filter((p) => Math.abs(daysBetween(p, date)) <= PAYDAY_WINDOW_DAYS)
    .sort((a, b) => Math.abs(daysBetween(a, date)) - Math.abs(daysBetween(b, date)))[0]
}

/**
 * The budget month containing `today` when months start on `startDay`
 * (1–28; e.g. 10 for a salary on the 10th), moved by any paydays marked by hand.
 * `offset` moves whole months: -1 is the previous one.
 */
export function budgetPeriod(
  today: IsoDate,
  startDay: number,
  offset = 0,
  paydays: readonly IsoDate[] = [],
): Period {
  const span = Math.abs(offset) + 2
  const t = fromIso(today)
  const from = dayInMonth(t.getUTCFullYear(), t.getUTCMonth() - span, 1)
  const to = dayInMonth(t.getUTCFullYear(), t.getUTCMonth() + span, 1)
  const starts = periodStarts(startDay, paydays, from, to)
  let i = -1
  for (let k = 0; k < starts.length; k++) if (starts[k]! <= today) i = k
  const start = starts[i + offset]!
  const next = starts[i + offset + 1]!
  return { start, end: addDays(next, -1) }
}

/**
 * When something due on `day` of the month falls in the period. A period moved
 * by an early or late payday may miss the day; then it's whichever end is nearer.
 */
export function dueDateInPeriod(period: Period, day: number): IsoDate {
  const s = fromIso(period.start)
  for (let m = 0; m <= 1; m++) {
    const d = dayInMonth(s.getUTCFullYear(), s.getUTCMonth() + m, day)
    if (d >= period.start && d <= period.end) return d
  }
  const before = dayInMonth(s.getUTCFullYear(), s.getUTCMonth(), day)
  const after = dayInMonth(s.getUTCFullYear(), s.getUTCMonth() + 1, day)
  return daysBetween(before, period.start) < daysBetween(period.end, after)
    ? period.start
    : period.end
}
