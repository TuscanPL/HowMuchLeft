// Bills that repeat every month, every few months, or once a year.
import type { MonthKey } from './dates.ts'

export const BILL_INTERVALS = [1, 2, 3, 6, 12] as const

export interface RecurringBill {
  amount: number
  /** 1 = monthly, 3 = quarterly, 12 = yearly. */
  every_months: number
  /** For bills not paid monthly: a month (1–12) it's paid in. */
  due_month: number | null
  /** Set aside a share every month (amount ÷ every_months) instead of all in the month it's due. */
  spread: boolean
}

function index(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number)
  return y! * 12 + m! - 1
}

function key(i: number): MonthKey {
  const y = Math.floor(i / 12)
  return `${y}-${String(i - y * 12 + 1).padStart(2, '0')}`
}

/** Whether the bill is paid in this budget month. */
export function billDueIn(bill: RecurringBill, month: MonthKey): boolean {
  const every = Math.max(1, bill.every_months)
  if (every === 1 || !bill.due_month) return true
  const diff = (index(month) % 12) - (bill.due_month - 1)
  return ((diff % every) + every) % every === 0
}

/** The first month from `month` on when the bill is paid. */
export function nextBillMonth(bill: RecurringBill, month: MonthKey): MonthKey {
  let i = index(month)
  for (let n = 0; n < 12 && !billDueIn(bill, key(i)); n++) i++
  return key(i)
}

/** What it costs per month on average (a yearly 600 zł is 50 zł a month). */
export function monthlyCost(bill: Pick<RecurringBill, 'amount' | 'every_months'>): number {
  return Math.round((bill.amount / Math.max(1, bill.every_months)) * 100) / 100
}
