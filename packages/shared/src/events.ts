// Events ("visiting Kasia"): someone checks in and out, then picks which of
// their charges from those days belong to it. An event is a tag on top of the
// category; it never changes the pocket.
//
// Banks give a date per charge, not a time, so an event covers whole days:
// from the check-in day to the check-out day. A forgotten check-out closes by
// itself at the end of the next day (see event_auto_end in the events migration).
import { addDays, todayIn, type IsoDate } from './dates.ts'

export const EVENT_TIME_ZONE = 'Europe/Warsaw'

export interface EventTimes {
  started_at: string
  ended_at: string | null
}

export interface EventSpan {
  /** First day, inclusive. */
  from: IsoDate
  /** Last day, inclusive (today while still checked in). */
  to: IsoDate
  /** Checked in and not out yet. */
  open: boolean
  /** Nobody checked out, so it closed at the end of the next day. */
  autoClosed: boolean
}

/** A timestamp's calendar day in Warsaw. */
export function localDay(timestamp: string, timeZone = EVENT_TIME_ZONE): IsoDate {
  return todayIn(timeZone, new Date(timestamp))
}

export function eventSpan(event: EventTimes, today: IsoDate): EventSpan {
  const from = localDay(event.started_at)
  if (event.ended_at) {
    return { from, to: localDay(event.ended_at), open: false, autoClosed: false }
  }
  const lastDay = addDays(from, 1)
  if (today <= lastDay)
    return { from, to: today < from ? from : today, open: true, autoClosed: false }
  return { from, to: lastDay, open: false, autoClosed: true }
}

export interface EventTransaction {
  id: string
  account_id: string
  booked_on: IsoDate
  amount: number
  event_id: string | null
}

/**
 * Charges worth suggesting for an event: on the checked-in person's accounts,
 * dated during the event, and not already in an event.
 */
export function eventCandidates<T extends EventTransaction>(
  event: EventTimes & { created_by: string | null },
  transactions: readonly T[],
  accounts: readonly { id: string; owner_id: string | null }[],
  today: IsoDate,
): T[] {
  if (!event.created_by) return []
  const mine = new Set(accounts.filter((a) => a.owner_id === event.created_by).map((a) => a.id))
  const { from, to } = eventSpan(event, today)
  return transactions.filter(
    (t) => !t.event_id && mine.has(t.account_id) && t.booked_on >= from && t.booked_on <= to,
  )
}

export interface EventTotal {
  /** Money out minus money back (a friend paying you back lowers it). */
  spent: number
  count: number
  /** budget − spent; null without a budget. */
  left: number | null
}

export function eventTotal(amounts: readonly number[], budget: number | null = null): EventTotal {
  const spent = Math.round(-amounts.reduce((a, b) => a + b, 0) * 100) / 100 || 0
  return {
    spent,
    count: amounts.length,
    left: budget === null ? null : Math.round((budget - spent) * 100) / 100,
  }
}
