// Turns Enable Banking's account, balance and transaction shapes into our rows.
import type { EbAccount, EbBalance, EbTransaction } from './enablebanking.ts'

/** Most useful first: what you can spend now, then the booked balance. */
const BALANCE_PREFERENCE = ['ITAV', 'CLAV', 'XPCD', 'ITBD', 'CLBD', 'OPAV', 'OPBD', 'PRCD', 'INFO']

export function pickBalance(balances: EbBalance[]): { amount: number; currency: string } | null {
  const ranked = [...balances].sort((a, b) => rank(a.balance_type) - rank(b.balance_type))
  const best = ranked[0]
  if (!best) return null
  const amount = Number(best.balance_amount.amount)
  return Number.isFinite(amount) ? { amount, currency: best.balance_amount.currency } : null
}

function rank(type: string): number {
  const i = BALANCE_PREFERENCE.indexOf(type)
  return i === -1 ? BALANCE_PREFERENCE.length : i
}

export function accountName(a: EbAccount): string {
  const iban = a.account_id?.iban
  return (
    a.name?.trim() ||
    a.product?.trim() ||
    a.details?.trim() ||
    (iban ? `…${iban.slice(-4)}` : 'Account')
  )
}

export interface TransactionRow {
  external_id: string
  status: 'booked' | 'pending'
  booked_on: string
  amount: number
  currency: string
  description: string
  counterparty: string | null
  counterparty_iban: string | null
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function mapTransactions(
  transactions: EbTransaction[],
  today: string,
): Promise<TransactionRow[]> {
  const rows: TransactionRow[] = []
  // Banks without ids get a hash of the visible fields; two identical payments on
  // the same day are told apart by their order in the bank's answer.
  const seen = new Map<string, number>()
  for (const t of transactions) {
    const debit = t.credit_debit_indicator === 'DBIT'
    const magnitude = Math.abs(Number(t.transaction_amount.amount))
    if (!Number.isFinite(magnitude)) continue
    const amount = debit ? -magnitude : magnitude
    const status = t.status === 'PDNG' ? 'pending' : 'booked'
    const bookedOn = (t.booking_date || t.value_date || t.transaction_date || today).slice(0, 10)
    const counterparty = (debit ? t.creditor?.name : t.debtor?.name)?.trim() || null
    const counterpartyIban =
      (debit ? t.creditor_account?.iban : t.debtor_account?.iban)?.replace(/\s+/g, '') || null
    const description =
      [
        ...(t.remittance_information ?? []),
        t.remittance_information?.length ? null : t.bank_transaction_code?.description,
        t.remittance_information?.length ? null : t.note,
      ]
        .filter((s): s is string => Boolean(s?.trim()))
        .map((s) => s.trim())
        .join(' ')
        .replace(/\s+/g, ' ') ||
      counterparty ||
      ''

    let externalId = t.entry_reference || t.transaction_id || null
    if (!externalId) {
      const key = [status, bookedOn, amount.toFixed(2), counterparty, description].join('|')
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      externalId = `h:${(await sha256Hex(key)).slice(0, 32)}:${n}`
    } else if (status === 'pending') {
      // A bank may reuse the id once the payment is booked; keep the two apart.
      externalId = `p:${externalId}`
    }

    rows.push({
      external_id: externalId,
      status,
      booked_on: bookedOn,
      amount: Math.round(amount * 100) / 100,
      currency: t.transaction_amount.currency,
      description,
      counterparty,
      counterparty_iban: counterpartyIban,
    })
  }
  return rows
}
