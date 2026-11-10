import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@hml/shared/database'
import type { SyncAccount, SyncStore } from './sync.ts'
import type { TransactionRow } from './mapping.ts'

export type ServiceClient = SupabaseClient<Database>

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

/** The SyncStore over the service-role client (bypasses RLS; only edge functions hold it). */
export function supabaseStore(db: ServiceClient): SyncStore {
  return {
    async accountsFor(connectionId) {
      const rows = check(
        await db
          .from('accounts')
          .select('id, household_id, external_uid')
          .eq('connection_id', connectionId)
          .not('external_uid', 'is', null),
      )
      return rows as SyncAccount[]
    },

    async setBalance(accountId, amount, at) {
      check(
        await db.from('accounts').update({ balance: amount, balance_at: at }).eq('id', accountId),
      )
    },

    async upsertTransactions(account, rows) {
      if (rows.length === 0) return [0, 0]
      const known = new Set<string>()
      for (let i = 0; i < rows.length; i += 200) {
        const ids = rows.slice(i, i + 200).map((r) => r.external_id)
        const existing = check(
          await db
            .from('transactions')
            .select('external_id')
            .eq('account_id', account.id)
            .in('external_id', ids),
        )
        for (const e of existing ?? []) known.add(e.external_id)
      }
      // Only bank fields are sent, so categories, notes and "ignored" survive a re-sync.
      const payload = rows.map((r) => ({
        ...r,
        household_id: account.household_id,
        account_id: account.id,
      }))
      for (let i = 0; i < payload.length; i += 200) {
        check(
          await db
            .from('transactions')
            .upsert(payload.slice(i, i + 200), { onConflict: 'account_id,external_id' }),
        )
      }
      const updated = rows.filter((r) => known.has(r.external_id)).length
      return [rows.length - updated, updated]
    },

    async prunePending(accountId, since, keep) {
      let q = db
        .from('transactions')
        .delete()
        .eq('account_id', accountId)
        .eq('status', 'pending')
        .gte('booked_on', since)
      if (keep.length) q = q.not('external_id', 'in', `(${keep.map((k) => `"${k}"`).join(',')})`)
      check(await q)
    },

    async markConnection(id, patch) {
      check(await db.from('bank_connections').update(patch).eq('id', id))
    },
  }
}
