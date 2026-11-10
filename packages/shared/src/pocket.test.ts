import { describe, expect, it } from 'vitest'
import { computePocket, round2, type PocketInput, type PocketTransaction } from './pocket.ts'

const categories: PocketInput['categories'] = [
  { id: 'food', name: 'Groceries', emoji: '🛒', kind: 'expense', monthly_limit: 1000 },
  { id: 'fun', name: 'Fun', emoji: '🎉', kind: 'expense', monthly_limit: null },
  { id: 'inc', name: 'Income', emoji: '💰', kind: 'income', monthly_limit: null },
  { id: 'xfer', name: 'Between our accounts', emoji: '🔁', kind: 'transfer', monthly_limit: null },
  { id: 'save', name: 'Savings', emoji: '🐷', kind: 'savings', monthly_limit: null },
]

let n = 0
function tx(
  booked_on: string,
  amount: number,
  extra: Partial<PocketTransaction> = {},
): PocketTransaction {
  return {
    id: `t${++n}`,
    booked_on,
    amount,
    category_id: null,
    bill_id: null,
    income_id: null,
    ignored: false,
    account_id: 'acc',
    ...extra,
  }
}

function base(transactions: PocketTransaction[], over: Partial<PocketInput> = {}): PocketInput {
  return {
    today: '2026-11-10',
    period: { start: '2026-11-01', end: '2026-11-30' },
    transactions,
    categories,
    bills: [
      { id: 'rent', name: 'Rent', amount: 3000, due_day: 5, active: true },
      { id: 'phone', name: 'Phone', amount: 50, due_day: 20, active: true },
      { id: 'old', name: 'Old gym', amount: 99, due_day: 1, active: false },
    ],
    incomes: [
      { id: 'me', name: 'My salary', amount: 6000, pay_day: 1, active: true },
      { id: 'her', name: 'Her salary', amount: 5000, pay_day: 28, active: true },
    ],
    goals: [
      { id: 'holiday', target: 5000, saved: 1000, monthly_contribution: 500 },
      { id: 'done', target: 100, saved: 100, monthly_contribution: 50 },
      { id: 'almost', target: 1000, saved: 900, monthly_contribution: 300 },
    ],
    ...over,
  }
}

describe('computePocket', () => {
  it('sets aside bills and goals from expected income before anything is spent', () => {
    const p = computePocket(base([]))
    // 11000 income − 3050 bills − (500 + 100) goals
    expect(p.income).toBe(11000)
    expect(p.bills).toBe(3050)
    expect(p.goals).toBe(600)
    expect(p.spent).toBe(0)
    expect(p.inPocket).toBe(7350)
    expect(p.daysLeft).toBe(21)
    expect(p.perDay).toBe(350)
  })

  it('uses what actually arrived and what was actually paid once matched', () => {
    const p = computePocket(
      base([
        tx('2026-11-01', 6200, { income_id: 'me', category_id: 'inc' }),
        tx('2026-11-05', -3100, { bill_id: 'rent' }),
      ]),
    )
    expect(p.income).toBe(11200)
    expect(p.bills).toBe(3150)
    expect(p.billsUnpaid).toBe(50)
    expect(p.billStatuses.map((b) => [b.bill.id, b.paid, b.due])).toEqual([
      ['rent', true, '2026-11-05'],
      ['phone', false, '2026-11-20'],
    ])
    expect(p.incomeStatuses.find((s) => s.income.id === 'her')?.received).toBe(false)
  })

  it('counts spending, refunds and uncategorised money out, but not transfers or savings', () => {
    const p = computePocket(
      base([
        tx('2026-11-02', -400, { category_id: 'food' }),
        tx('2026-11-03', -700, { category_id: 'food' }),
        tx('2026-11-04', 100, { category_id: 'food' }), // refund
        tx('2026-11-04', -80), // uncategorised
        tx('2026-11-06', -2000, { category_id: 'xfer' }),
        tx('2026-11-06', 2000, { category_id: 'xfer' }),
        tx('2026-11-07', -500, { category_id: 'save' }),
        tx('2026-11-08', -999, { category_id: 'fun', ignored: true }),
        tx('2026-10-31', -999, { category_id: 'fun' }), // last period
        tx('2026-11-09', 150), // money in with no category: other income
      ]),
    )
    expect(p.spent).toBe(1080)
    expect(p.otherIncome).toBe(150)
    expect(p.inPocket).toBe(11150 - 3050 - 600 - 1080)
    const food = p.categories.find((c) => c.category?.id === 'food')
    expect(food).toMatchObject({ spent: 1000, limit: 1000, left: 0 })
    expect(p.categories.at(-1)).toMatchObject({ category: null, spent: 80 })
    expect(p.overBudget).toEqual([])
  })

  it('flags a category over its budget', () => {
    const p = computePocket(base([tx('2026-11-02', -1200.5, { category_id: 'food' })]))
    expect(p.overBudget.map((c) => [c.category?.id, c.left])).toEqual([['food', -200.5]])
  })

  it('treats a payment for a switched-off bill as spending', () => {
    const p = computePocket(base([tx('2026-11-01', -99, { bill_id: 'old' })]))
    expect(p.spent).toBe(99)
  })

  it('leaves out accounts that are not in the pocket', () => {
    const p = computePocket(
      base([tx('2026-11-02', -100, { account_id: 'savings-acc' }), tx('2026-11-02', -10)], {
        pocketAccountIds: new Set(['acc']),
      }),
    )
    expect(p.spent).toBe(10)
  })

  it('can go negative and still splits per day', () => {
    const p = computePocket(
      base([tx('2026-11-02', -8000, { category_id: 'fun' })], { today: '2026-11-30' }),
    )
    expect(p.inPocket).toBe(-650)
    expect(p.daysLeft).toBe(1)
    expect(p.perDay).toBe(-650)
  })

  it('shows what is available until the second salary comes', () => {
    // Her salary (day 1) is in, mine (day 28) is still to come; rent paid, phone due on the 20th.
    const p = computePocket(
      base([
        tx('2026-11-01', 5000, { income_id: 'her', category_id: 'inc' }),
        tx('2026-11-05', -3000, { bill_id: 'rent' }),
        tx('2026-11-06', -400, { category_id: 'food' }),
      ]),
    )
    expect(p.incomeStatuses.map((s) => [s.income.id, s.received, s.arrivedOn])).toEqual([
      ['me', false, null],
      ['her', true, '2026-11-01'],
    ])
    // No month in the period: falls back to the day inside the period.
    expect(p.nextInflux).toMatchObject({ income: { id: 'me' }, expected: '2026-11-01', late: true })
  })

  it('counts days and cash until a salary expected later', () => {
    const p = computePocket(
      base(
        [
          tx('2026-11-01', 6000, { income_id: 'me', category_id: 'inc' }),
          tx('2026-11-05', -3000, { bill_id: 'rent' }),
          tx('2026-11-06', -400, { category_id: 'food' }),
        ],
        {
          period: { start: '2026-11-01', end: '2026-11-30', month: '2026-11' },
          incomes: [
            { id: 'me', name: 'My salary', amount: 6000, pay_day: 1, active: true },
            { id: 'her', name: 'Her salary', amount: 5000, pay_day: 22, active: true },
          ],
        },
      ),
    )
    // 6000 in − 3000 rent − 50 phone (due the 20th, before her pay on the 22nd) − 400 spent
    expect(p.nextInflux).toEqual({
      income: expect.objectContaining({ id: 'her' }),
      expected: '2026-11-22',
      late: false,
      available: 2550,
      daysUntil: 12,
      perDay: round2(2550 / 12),
    })
  })

  it('a salary paid on the 28th is already next month’s', () => {
    const p = computePocket(
      base([], { period: { start: '2026-11-01', end: '2026-11-30', month: '2026-12' } }),
    )
    expect(p.incomeStatuses.find((s) => s.income.id === 'her')?.expected).toBe('2026-11-28')
  })

  it('has no next influx once every salary is in', () => {
    const p = computePocket(
      base([
        tx('2026-11-01', 6000, { income_id: 'me' }),
        tx('2026-11-02', 5000, { income_id: 'her' }),
      ]),
    )
    expect(p.nextInflux).toBeNull()
  })
})
