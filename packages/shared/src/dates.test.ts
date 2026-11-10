import { describe, expect, it } from 'vitest'
import {
  budgetPeriod,
  expectedPayDate,
  dayInMonth,
  dueDateInPeriod,
  onePerMonth,
  paydayNear,
  todayIn,
} from './dates.ts'

describe('budgetPeriod', () => {
  it('is the calendar month when months start on the 1st', () => {
    expect(budgetPeriod('2026-11-10', 1)).toMatchObject({ start: '2026-11-01', end: '2026-11-30' })
  })
  it('runs payday to the day before the next payday', () => {
    expect(budgetPeriod('2026-11-10', 10)).toMatchObject({ start: '2026-11-10', end: '2026-12-09' })
    expect(budgetPeriod('2026-11-09', 10)).toMatchObject({ start: '2026-10-10', end: '2026-11-09' })
  })
  it('crosses the year', () => {
    expect(budgetPeriod('2027-01-05', 25)).toMatchObject({ start: '2026-12-25', end: '2027-01-24' })
    expect(budgetPeriod('2026-12-05', 1, 1)).toMatchObject({
      start: '2027-01-01',
      end: '2027-01-31',
    })
  })
  it('moves by whole months with an offset', () => {
    expect(budgetPeriod('2026-03-15', 1, -1)).toMatchObject({
      start: '2026-02-01',
      end: '2026-02-28',
    })
  })
})

describe('paydays', () => {
  it('an early salary starts the month early and the usual day is skipped', () => {
    const paydays = ['2026-11-07']
    expect(budgetPeriod('2026-11-07', 10, 0, paydays)).toMatchObject({
      start: '2026-11-07',
      end: '2026-12-09',
    })
    expect(budgetPeriod('2026-11-11', 10, 0, paydays)).toMatchObject({
      start: '2026-11-07',
      end: '2026-12-09',
    })
    expect(budgetPeriod('2026-11-07', 10, -1, paydays)).toMatchObject({
      start: '2026-10-10',
      end: '2026-11-06',
    })
  })

  it('a late salary keeps the old month going until it arrives', () => {
    const paydays = ['2026-11-13']
    expect(budgetPeriod('2026-11-12', 10, 0, paydays)).toMatchObject({
      start: '2026-10-10',
      end: '2026-11-12',
    })
    expect(budgetPeriod('2026-11-13', 10, 0, paydays)).toMatchObject({
      start: '2026-11-13',
      end: '2026-12-09',
    })
  })

  it('two presses a couple of days apart make one month, from the first', () => {
    const both = ['2026-11-08', '2026-11-10']
    expect(budgetPeriod('2026-11-20', 10, 0, both)).toMatchObject({
      start: '2026-11-08',
      end: '2026-12-09',
    })
    expect(budgetPeriod('2026-11-20', 10, -1, both)).toMatchObject({
      start: '2026-10-10',
      end: '2026-11-07',
    })
    expect(onePerMonth(['2026-12-09', '2026-11-10', '2026-11-08'])).toEqual([
      '2026-11-08',
      '2026-12-09',
    ])
  })

  it('finds the payday already marked for this month', () => {
    expect(paydayNear(['2026-10-09', '2026-11-08'], '2026-11-10')).toBe('2026-11-08')
    expect(paydayNear(['2026-10-09'], '2026-11-10')).toBeUndefined()
  })

  it('works across the year with offsets', () => {
    const paydays = ['2026-12-23', '2027-01-27']
    expect(budgetPeriod('2027-01-05', 25, 0, paydays)).toMatchObject({
      start: '2026-12-23',
      end: '2027-01-26',
    })
    expect(budgetPeriod('2027-01-05', 25, -1, paydays)).toMatchObject({
      start: '2026-11-25',
      end: '2026-12-22',
    })
  })
})

describe('dueDateInPeriod', () => {
  it('finds the due day inside a period that spans two months', () => {
    const p = { start: '2026-11-10', end: '2026-12-09' }
    expect(dueDateInPeriod(p, 15)).toBe('2026-11-15')
    expect(dueDateInPeriod(p, 5)).toBe('2026-12-05')
  })
  it('falls back to the nearest end when a moved month skips the day', () => {
    expect(dueDateInPeriod({ start: '2026-11-12', end: '2026-12-09' }, 10)).toBe('2026-12-09')
    expect(dueDateInPeriod({ start: '2026-11-07', end: '2026-11-09' }, 5)).toBe('2026-11-07')
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

describe('two salaries', () => {
  // Hers usually comes on the 1st, mine on the 10th.
  const plan = (arrivals: { date: string; payDay: number }[] = [], paydays: string[] = []) => ({
    startDay: 1,
    payDays: [1, 10],
    arrivals,
    paydays,
  })

  it('starts on the earliest expected payday until a salary arrives', () => {
    expect(budgetPeriod('2026-11-05', plan())).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
      month: '2026-11',
      arrived: false,
    })
  })

  it('her early salary in the last week of October starts November', () => {
    const p = plan([{ date: '2026-10-28', payDay: 1 }])
    expect(budgetPeriod('2026-10-28', p)).toMatchObject({
      start: '2026-10-28',
      end: '2026-11-30',
      month: '2026-11',
      arrived: true,
    })
    expect(budgetPeriod('2026-10-28', p, -1)).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-27',
      month: '2026-10',
    })
  })

  it('my salary on the 10th is the second influx, not a new month', () => {
    const p = plan([
      { date: '2026-11-01', payDay: 1 },
      { date: '2026-11-10', payDay: 10 },
    ])
    expect(budgetPeriod('2026-11-12', p)).toMatchObject({
      start: '2026-11-01',
      end: '2026-11-30',
      month: '2026-11',
    })
  })

  it('if mine arrives first (hers is late), mine starts the month', () => {
    const p = plan([
      { date: '2026-10-09', payDay: 10 },
      { date: '2026-10-03', payDay: 1 },
    ])
    expect(budgetPeriod('2026-10-05', p)).toMatchObject({ start: '2026-10-03', month: '2026-10' })
  })

  it('a salary paid on the 25th belongs to the next month', () => {
    const p = { startDay: 1, payDays: [25], arrivals: [{ date: '2026-10-23', payDay: 25 }] }
    // Paid two days early, still before the 24th: nearest expected day is Oct 25 → November.
    expect(budgetPeriod('2026-10-23', p)).toMatchObject({
      start: '2026-10-23',
      end: '2026-11-24',
      month: '2026-11',
    })
    expect(expectedPayDate('2026-11', 25)).toBe('2026-10-25')
    expect(expectedPayDate('2026-11', 10)).toBe('2026-11-10')
  })

  it('anything that arrives from the 24th on is for next month, however late', () => {
    // My salary for the 10th turns up very late, on Nov 26: it is December's.
    const p = { startDay: 1, payDays: [10], arrivals: [{ date: '2026-11-26', payDay: 10 }] }
    expect(budgetPeriod('2026-11-27', p)).toMatchObject({ start: '2026-11-26', month: '2026-12' })
  })

  it('a pressed payday counts as an arrival', () => {
    expect(budgetPeriod('2026-10-30', plan([], ['2026-10-29']))).toMatchObject({
      start: '2026-10-29',
      month: '2026-11',
      arrived: true,
    })
  })
})
