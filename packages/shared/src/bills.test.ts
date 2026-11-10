import { describe, expect, it } from 'vitest'
import { billDueIn, monthlyCost, nextBillMonth } from './bills.ts'

const yearly = { amount: 600, every_months: 12, due_month: 3, spread: false }
const quarterly = { amount: 300, every_months: 3, due_month: 2, spread: false }

describe('recurring bills', () => {
  it('a monthly bill is due every month', () => {
    expect(
      billDueIn({ amount: 50, every_months: 1, due_month: null, spread: false }, '2026-11'),
    ).toBe(true)
  })
  it('a yearly bill only in its month', () => {
    expect(billDueIn(yearly, '2027-03')).toBe(true)
    expect(billDueIn(yearly, '2026-11')).toBe(false)
    expect(nextBillMonth(yearly, '2026-11')).toBe('2027-03')
    expect(nextBillMonth(yearly, '2027-03')).toBe('2027-03')
  })
  it('a quarterly bill every third month from its month', () => {
    expect(
      ['2026-11', '2026-12', '2027-01', '2027-02'].map((m) => billDueIn(quarterly, m)),
    ).toEqual([true, false, false, true])
  })
  it('monthly cost spreads the amount', () => {
    expect(monthlyCost(yearly)).toBe(50)
    expect(monthlyCost({ amount: 100, every_months: 3 })).toBe(33.33)
  })
})
