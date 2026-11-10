// The "In My Pocket" number, PocketGuard style: what's left to spend this
// budget month once income has come in and bills and savings are set aside.
//
//   in pocket = income − bills − goals − spending so far
//
// - income: each expected income counts its matched transfer once it arrived
//   (else the expected amount), plus any other money in that isn't a transfer
//   between our accounts, savings, or a refund in a spending category.
// - bills: each active bill counts what was actually paid once matched, else
//   the expected amount, so a bill still to come is already set aside.
// - goals: the monthly contribution of every goal not yet reached.
// - spending: money out in spending (or uncategorised) transactions that are
//   not bills; refunds in a spending category reduce it.
// Transfers between our accounts and savings movements never count; neither do
// ignored transactions or accounts left out of the pocket.
import type { CategoryKind } from './enums.ts'
import {
  addDays,
  daysBetween,
  dueDateInPeriod,
  expectedPayDate,
  type IsoDate,
  type Period,
} from './dates.ts'

export interface PocketTransaction {
  id: string
  booked_on: IsoDate
  amount: number
  category_id: string | null
  bill_id: string | null
  income_id: string | null
  ignored: boolean
  account_id: string
}

export interface PocketCategory {
  id: string
  name: string
  emoji: string
  kind: CategoryKind
  monthly_limit: number | null
}

export interface PocketBill {
  id: string
  name: string
  amount: number
  due_day: number
  active: boolean
}

export interface PocketIncome {
  id: string
  name: string
  amount: number
  pay_day: number
  active: boolean
}

export interface PocketGoal {
  id: string
  target: number
  saved: number
  monthly_contribution: number
}

export interface PocketInput {
  today: IsoDate
  period: Period
  transactions: PocketTransaction[]
  categories: PocketCategory[]
  bills: PocketBill[]
  incomes: PocketIncome[]
  goals: PocketGoal[]
  /** Accounts whose transactions count. Omit to count every account. */
  pocketAccountIds?: Set<string>
}

export interface BillStatus {
  bill: PocketBill
  due: IsoDate
  paid: boolean
  /** What was paid (positive), or the expected amount when not paid yet. */
  amount: number
}

export interface IncomeStatus {
  income: PocketIncome
  expected: IsoDate
  received: boolean
  /** When it actually came (the first payment, if split). */
  arrivedOn: IsoDate | null
  amount: number
}

/**
 * Money already in until the next salary comes: income received so far, minus
 * bills paid or due by that day (it may land late in the day), minus spending so far. Goals aren't taken off:
 * this is about cash, so you can plan the days before the second salary.
 */
export interface NextInflux {
  income: PocketIncome
  expected: IsoDate
  /** Expected day already passed and it hasn't come. */
  late: boolean
  available: number
  /** Days from today until it's expected (null when late). */
  daysUntil: number | null
  perDay: number | null
}

export interface CategorySpend {
  category: PocketCategory | null
  spent: number
  limit: number | null
  /** limit − spent; null without a limit. */
  left: number | null
}

export interface Pocket {
  period: Period
  income: number
  otherIncome: number
  bills: number
  billsUnpaid: number
  goals: number
  spent: number
  inPocket: number
  /** Days left in the period, today included. */
  daysLeft: number
  perDay: number
  billStatuses: BillStatus[]
  incomeStatuses: IncomeStatus[]
  /** The next salary still to come this month, if any. */
  nextInflux: NextInflux | null
  categories: CategorySpend[]
  /** Spending categories over their budget: the pocket already absorbs it, but it's worth a warning. */
  overBudget: CategorySpend[]
}

export const round2 = (n: number) => Math.round(n * 100) / 100

export function computePocket(input: PocketInput): Pocket {
  const { period, today } = input
  const categoryById = new Map(input.categories.map((c) => [c.id, c]))
  const inPeriod = input.transactions.filter(
    (t) =>
      !t.ignored &&
      t.booked_on >= period.start &&
      t.booked_on <= period.end &&
      (!input.pocketAccountIds || input.pocketAccountIds.has(t.account_id)),
  )

  // Bills: paid amount once matched, else the expected amount.
  const billStatuses: BillStatus[] = input.bills
    .filter((b) => b.active)
    .map((bill) => {
      const paidTx = inPeriod.filter((t) => t.bill_id === bill.id)
      const paid = paidTx.length > 0
      return {
        bill,
        due: dueDateInPeriod(period, bill.due_day),
        paid,
        amount: paid ? round2(-sum(paidTx.map((t) => t.amount))) : bill.amount,
      }
    })
    .sort((a, b) => a.due.localeCompare(b.due))
  // A payment matched to a bill that was since switched off counts like any other spending.
  const activeBillIds = new Set(billStatuses.map((s) => s.bill.id))

  const incomeStatuses: IncomeStatus[] = input.incomes
    .filter((i) => i.active)
    .map((income) => {
      const got = inPeriod.filter((t) => t.income_id === income.id)
      const received = got.length > 0
      return {
        income,
        // A salary paid late in a month is expected in the month before (see LATE_MONTH_DAY).
        expected: period.month
          ? expectedPayDate(period.month, income.pay_day)
          : dueDateInPeriod(period, income.pay_day),
        received,
        arrivedOn: received ? got.map((t) => t.booked_on).sort()[0]! : null,
        amount: received ? round2(sum(got.map((t) => t.amount))) : income.amount,
      }
    })
    .sort((a, b) => a.expected.localeCompare(b.expected))
  const activeIncomeIds = new Set(incomeStatuses.map((s) => s.income.id))

  let otherIncome = 0
  let spent = 0
  const spentByCategory = new Map<string | null, number>()
  for (const t of inPeriod) {
    if (t.bill_id && activeBillIds.has(t.bill_id)) continue
    if (t.income_id && activeIncomeIds.has(t.income_id)) continue
    const category = t.category_id ? categoryById.get(t.category_id) : undefined
    const kind = category?.kind
    if (kind === 'transfer' || kind === 'savings') continue
    if (kind === 'income' || (!category && t.amount > 0)) {
      otherIncome += t.amount
      continue
    }
    // An expense category (or uncategorised money out): refunds come back in.
    spent -= t.amount
    const key = category?.id ?? null
    spentByCategory.set(key, (spentByCategory.get(key) ?? 0) - t.amount)
  }

  const goals = sum(
    input.goals
      .filter((g) => g.saved < g.target)
      .map((g) => Math.min(g.monthly_contribution, g.target - g.saved)),
  )
  const income = sum(incomeStatuses.map((s) => s.amount)) + otherIncome
  const bills = sum(billStatuses.map((s) => s.amount))
  const billsUnpaid = sum(billStatuses.filter((s) => !s.paid).map((s) => s.amount))
  const inPocket = round2(income - bills - goals - spent)
  const daysLeft = Math.max(
    1,
    daysBetween(today < period.start ? period.start : today, addDays(period.end, 1)),
  )

  const pending = incomeStatuses.filter((s) => !s.received)
  let nextInflux: NextInflux | null = null
  if (pending.length) {
    const next = pending[0]!
    const late = next.expected <= today
    const cutoff = late ? today : next.expected
    const receivedSoFar = sum(incomeStatuses.filter((s) => s.received).map((s) => s.amount))
    const billsBefore = sum(
      billStatuses.filter((b) => b.paid || b.due <= cutoff).map((b) => b.amount),
    )
    const available = round2(receivedSoFar + otherIncome - billsBefore - spent)
    const daysUntil = late ? null : Math.max(1, daysBetween(today, next.expected))
    nextInflux = {
      income: next.income,
      expected: next.expected,
      late,
      available,
      daysUntil,
      perDay: daysUntil === null ? null : round2(available / daysUntil),
    }
  }

  const categories: CategorySpend[] = input.categories
    .filter((c) => c.kind === 'expense')
    .map((c) => categorySpend(c, spentByCategory.get(c.id) ?? 0))
  const uncategorised = spentByCategory.get(null)
  if (uncategorised) categories.push(categorySpend(null, uncategorised))

  return {
    period,
    income: round2(income),
    otherIncome: round2(otherIncome),
    bills: round2(bills),
    billsUnpaid: round2(billsUnpaid),
    goals: round2(goals),
    spent: round2(spent),
    inPocket,
    daysLeft,
    perDay: round2(inPocket / daysLeft),
    billStatuses,
    incomeStatuses,
    nextInflux,
    categories,
    overBudget: categories.filter((c) => c.left !== null && c.left < 0),
  }
}

function categorySpend(category: PocketCategory | null, spent: number): CategorySpend {
  const limit = category?.monthly_limit ?? null
  return {
    category,
    spent: round2(spent),
    limit,
    left: limit === null ? null : round2(limit - spent),
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
