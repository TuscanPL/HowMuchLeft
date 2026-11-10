import { describe, expect, it } from 'vitest'
import { budgetPeriod, dayInMonth, dueDateInPeriod, todayIn } from './dates.ts'

describe('budgetPeriod', () => {
  it('is the calendar month when months start on the 1st', () => {
    expect(budgetPeriod('2026-11-10', 1)).toEqual({ start: '2026-11-01', end: '2026-11-30' })
  })
  it('runs payday to the day before the next payday', () => {
    expect(budgetPeriod('2026-11-10', 10)).toEqual({ start: '2026-11-10', end: '2026-12-09' })
    expect(budgetPeriod('2026-11-09', 10)).toEqual({ start: '2026-10-10', end: '2026-11-09' })
  })
  it('crosses the year', () => {
    expect(budgetPeriod('2027-01-05', 25)).toEqual({ start: '2026-12-25', end: '2027-01-24' })
    expect(budgetPeriod('2026-12-05', 1, 1)).toEqual({ start: '2027-01-01', end: '2027-01-31' })
  })
  it('moves by whole months with an offset', () => {
    expect(budgetPeriod('2026-03-15', 1, -1)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
})

describe('dueDateInPeriod', () => {
  it('finds the due day inside a period that spans two months', () => {
    const p = { start: '2026-11-10', end: '2026-12-09' }
    expect(dueDateInPeriod(p, 15)).toBe('2026-11-15')
    expect(dueDateInPeriod(p, 5)).toBe('2026-12-05')
  })
  it('clamps day 31 to short months', () => {
    expect(dueDateInPeriod({ start: '2026-02-01', end: '2026-02-28' }, 31)).toBe('2026-02-28')
    expect(dayInMonth(2028, 1, 30)).toBe('2028-02-29')
  })
})

describe('todayIn', () => {
  it('uses Warsaw time, not UTC', () => {
    expect(todayIn('Europe/Warsaw', new Date('2026-11-10T23:30:00Z'))).toBe('2026-11-11')
  })
})
