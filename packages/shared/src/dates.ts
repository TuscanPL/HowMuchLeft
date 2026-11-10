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

/**
 * The budget month containing `today` when months start on `startDay`
 * (1–28; e.g. 10 for a salary on the 10th). `offset` moves whole months: -1 is the previous one.
 */
export function budgetPeriod(today: IsoDate, startDay: number, offset = 0): Period {
  const t = fromIso(today)
  let month0 = t.getUTCMonth()
  if (t.getUTCDate() < startDay) month0 -= 1
  month0 += offset
  const year = t.getUTCFullYear()
  const start = dayInMonth(year, month0, startDay)
  const end = addDays(dayInMonth(year, month0 + 1, startDay), -1)
  return { start, end }
}

/** When something due on `day` of the month falls inside the period (at most once, as periods are a month long). */
export function dueDateInPeriod(period: Period, day: number): IsoDate {
  const s = fromIso(period.start)
  const first = dayInMonth(s.getUTCFullYear(), s.getUTCMonth(), day)
  return first >= period.start ? first : dayInMonth(s.getUTCFullYear(), s.getUTCMonth() + 1, day)
}
