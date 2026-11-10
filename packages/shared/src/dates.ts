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
  /** The calendar month this budget is for ("2026-11"). */
  month?: string
  /** It started because a salary arrived (or someone pressed Payday), not just by the calendar. */
  arrived?: boolean
}

/** How close (in days) a pressed "payday" counts as the same month's (see mark_payday). */
export const PAYDAY_WINDOW_DAYS = 15

/**
 * Money that arrives from this day of a month on is for the next month: a
 * salary paid in the last week of October is November's (an early payday).
 * The same day for every month, so a salary paid on the 24th always lands in
 * the same budget month.
 */
export const LATE_MONTH_DAY = 24

/** "2026-11" */
export type MonthKey = string

function monthIndex(date: IsoDate): number {
  const d = fromIso(date)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

function monthKey(index: number): MonthKey {
  const y = Math.floor(index / 12)
  const m = index - y * 12 + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

function dateIn(index: number, day: number): IsoDate {
  return dayInMonth(Math.floor(index / 12), index % 12, day)
}

/** When a salary paid on `payDay` is expected for budget month `index` (late-month days fall in the month before). */
function expectedFor(index: number, payDay: number): IsoDate {
  return payDay >= LATE_MONTH_DAY ? dateIn(index - 1, payDay) : dateIn(index, payDay)
}

/** When a salary paid on `payDay` is expected for a budget month ("2026-11"). */
export function expectedPayDate(month: MonthKey, payDay: number): IsoDate {
  const [y, m] = month.split('-').map(Number)
  return expectedFor(y! * 12 + m! - 1, payDay)
}

export interface PaydayPlan {
  /** Fallback when no salaries are set up: the usual first day of a budget month. */
  startDay: number
  /** The days salaries usually come (incomes that start the month). */
  payDays?: readonly number[]
  /** Salaries that actually arrived; `payDay` is that salary's usual day. */
  arrivals?: readonly { date: IsoDate; payDay: number }[]
  /** Days someone pressed "Payday" by hand. */
  paydays?: readonly IsoDate[]
}

/** Where each budget month starts, and why. */
export interface MonthStart {
  month: MonthKey
  start: IsoDate
  /** Set when a salary arrival or a pressed payday started it (not just the calendar). */
  arrived: boolean
}

/**
 * Every budget month's start, for months `fromIndex`..`toIndex`. A month starts
 * with the first salary (or pressed payday) to arrive for it; until one does,
 * on the earliest day a salary is expected.
 */
function monthStarts(plan: PaydayPlan, fromIndex: number, toIndex: number): MonthStart[] {
  const payDays = plan.payDays?.length ? [...plan.payDays] : null
  const expectedStart = (index: number): IsoDate =>
    payDays
      ? payDays.map((p) => expectedFor(index, p)).sort()[0]!
      : expectedFor(index, plan.startDay)

  // Which budget month an arrival belongs to: the one whose expected date is
  // nearest, but never the current month or earlier from the 24th on.
  const attribute = (date: IsoDate, expected: (index: number) => IsoDate): number => {
    const own = monthIndex(date)
    const late = fromIso(date).getUTCDate() >= LATE_MONTH_DAY
    const candidates = late ? [own + 1, own + 2] : [own - 1, own, own + 1]
    return candidates.reduce((best, c) =>
      Math.abs(daysBetween(expected(c), date)) < Math.abs(daysBetween(expected(best), date))
        ? c
        : best,
    )
  }

  const earliest = new Map<number, IsoDate>()
  const note = (index: number, date: IsoDate) => {
    const cur = earliest.get(index)
    if (!cur || date < cur) earliest.set(index, date)
  }
  for (const a of plan.arrivals ?? [])
    note(
      attribute(a.date, (i) => expectedFor(i, a.payDay)),
      a.date,
    )
  for (const p of onePerMonth(plan.paydays ?? [])) note(attribute(p, expectedStart), p)

  const starts: MonthStart[] = []
  for (let index = fromIndex; index <= toIndex; index++) {
    const arrived = earliest.get(index)
    const start = arrived ?? expectedStart(index)
    // Months must follow each other; an odd arrival can't make one start before the last.
    if (starts.length && start <= starts.at(-1)!.start) continue
    starts.push({ month: monthKey(index), start, arrived: Boolean(arrived) })
  }
  return starts
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
 * The budget month containing `today`. Pass a plan (salary days, arrivals,
 * pressed paydays), or just the usual start day. `offset` moves whole months:
 * -1 is the previous one.
 */
export function budgetPeriod(
  today: IsoDate,
  plan: PaydayPlan | number,
  offset = 0,
  paydays: readonly IsoDate[] = [],
): Period {
  const p: PaydayPlan = typeof plan === 'number' ? { startDay: plan, paydays } : plan
  const span = Math.abs(offset) + 3
  const here = monthIndex(today)
  const starts = monthStarts(p, here - span, here + span)
  let i = -1
  for (let k = 0; k < starts.length; k++) if (starts[k]!.start <= today) i = k
  const cur = starts[i + offset]!
  const next = starts[i + offset + 1]!
  return { start: cur.start, end: addDays(next.start, -1), month: cur.month, arrived: cur.arrived }
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
