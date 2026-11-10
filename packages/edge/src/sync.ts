// Pulls balances and transactions for bank connections into the database.
// Storage goes through the small SyncStore interface so the logic is tested
// without a database (supabaseStore.ts is the real one).
import type { ConnectionStatus, SyncSummary } from '@hml/shared'
import { addDays, todayIn } from '@hml/shared'
import { EnableBankingError, type EnableBanking, type PsuContext } from './enablebanking.ts'
import { mapTransactions, pickBalance, type TransactionRow } from './mapping.ts'

/** How far back the first sync of a new account goes. */
export const FIRST_SYNC_DAYS = 90
/** Later syncs re-read this many days before the last one, so late bookings are caught. */
export const OVERLAP_DAYS = 10

export interface SyncConnection {
  id: string
  household_id: string
  session_id: string | null
  status: string
  valid_until: string | null
  last_synced_at: string | null
}

export interface SyncAccount {
  id: string
  household_id: string
  external_uid: string
}

export interface SyncStore {
  accountsFor(connectionId: string): Promise<SyncAccount[]>
  setBalance(accountId: string, amount: number, at: string): Promise<void>
  /** Inserts new rows and refreshes the bank fields of known ones; returns [inserted, updated]. */
  upsertTransactions(account: SyncAccount, rows: TransactionRow[]): Promise<[number, number]>
  /** Drops pending rows from `since` on that the bank no longer reports (booked or cancelled). */
  prunePending(accountId: string, since: string, keepExternalIds: string[]): Promise<void>
  markConnection(
    id: string,
    patch: { status?: ConnectionStatus; last_synced_at?: string; last_error?: string | null },
  ): Promise<void>
}

export async function syncConnection(
  bank: EnableBanking,
  store: SyncStore,
  connection: SyncConnection,
  opts: { psu?: PsuContext; now?: Date } = {},
): Promise<{ accounts: number; inserted: number; updated: number }> {
  const now = opts.now ?? new Date()
  const today = todayIn('Europe/Warsaw', now)
  if (!connection.session_id || connection.status === 'revoked') {
    return { accounts: 0, inserted: 0, updated: 0 }
  }
  if (connection.valid_until && new Date(connection.valid_until) <= now) {
    await store.markConnection(connection.id, {
      status: 'expired',
      last_error: 'The bank consent has ended. Connect the bank again.',
    })
    return { accounts: 0, inserted: 0, updated: 0 }
  }

  const dateFrom = connection.last_synced_at
    ? addDays(connection.last_synced_at.slice(0, 10), -OVERLAP_DAYS)
    : addDays(today, -FIRST_SYNC_DAYS)

  let inserted = 0
  let updated = 0
  const accounts = await store.accountsFor(connection.id)
  try {
    for (const account of accounts) {
      const balance = pickBalance(await bank.balances(account.external_uid, opts.psu))
      if (balance) await store.setBalance(account.id, balance.amount, now.toISOString())

      const rows = await mapTransactions(
        await bank.transactions(account.external_uid, dateFrom, opts.psu),
        today,
      )
      const [ins, upd] = await store.upsertTransactions(account, rows)
      inserted += ins
      updated += upd
      await store.prunePending(
        account.id,
        dateFrom,
        rows.filter((r) => r.status === 'pending').map((r) => r.external_id),
      )
    }
  } catch (e) {
    const ended = e instanceof EnableBankingError && e.consentEnded
    await store.markConnection(connection.id, {
      status: ended ? 'expired' : 'error',
      last_error: ended
        ? 'The bank consent has ended. Connect the bank again.'
        : (e as Error).message.slice(0, 500),
    })
    throw e
  }

  await store.markConnection(connection.id, {
    status: 'active',
    last_synced_at: now.toISOString(),
    last_error: null,
  })
  return { accounts: accounts.length, inserted, updated }
}

export async function syncMany(
  bank: EnableBanking,
  store: SyncStore,
  connections: SyncConnection[],
  opts: { psu?: PsuContext; now?: Date } = {},
): Promise<SyncSummary> {
  const summary: SyncSummary = { connections: 0, accounts: 0, inserted: 0, updated: 0, errors: [] }
  for (const c of connections) {
    try {
      const r = await syncConnection(bank, store, c, opts)
      summary.connections += 1
      summary.accounts += r.accounts
      summary.inserted += r.inserted
      summary.updated += r.updated
    } catch (e) {
      summary.errors.push({ connectionId: c.id, message: (e as Error).message })
    }
  }
  return summary
}
