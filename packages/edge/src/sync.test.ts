import { describe, expect, it, vi } from 'vitest'
import { syncConnection, syncMany, type SyncStore } from './sync.ts'
import { EnableBankingError, type EnableBanking } from './enablebanking.ts'

function memoryStore() {
  const tx = new Map<string, { status: string; booked_on: string }>()
  const marks: Array<{ id: string; patch: unknown }> = []
  const balances = new Map<string, number>()
  const store: SyncStore = {
    accountsFor: async () => [{ id: 'acc1', household_id: 'h1', external_uid: 'uid1' }],
    setBalance: async (id, amount) => void balances.set(id, amount),
    upsertTransactions: async (_a, rows) => {
      let ins = 0
      for (const r of rows) {
        if (!tx.has(r.external_id)) ins++
        tx.set(r.external_id, r)
      }
      return [ins, rows.length - ins]
    },
    prunePending: async (_id, since, keep) => {
      for (const [k, v] of tx)
        if (v.status === 'pending' && v.booked_on >= since && !keep.includes(k)) tx.delete(k)
    },
    markConnection: async (id, patch) => void marks.push({ id, patch }),
  }
  return { store, tx, marks, balances }
}

function fakeBank(transactions: unknown[][]): EnableBanking & { froms: string[] } {
  const froms: string[] = []
  return {
    froms,
    aspsps: vi.fn(),
    startAuthorization: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    balances: async () => [
      { balance_type: 'ITAV', balance_amount: { amount: '1234.56', currency: 'PLN' } },
    ],
    transactions: async (_uid: string, from: string) => {
      froms.push(from)
      return (transactions.shift() ?? []) as never
    },
  } as never
}

const conn = {
  id: 'c1',
  household_id: 'h1',
  session_id: 's1',
  status: 'active',
  valid_until: '2027-05-01T00:00:00Z',
  last_synced_at: null as string | null,
}
const now = new Date('2026-11-10T08:00:00Z')

const t = (ref: string, amount: string, status = 'BOOK') => ({
  entry_reference: ref,
  transaction_amount: { amount, currency: 'PLN' },
  credit_debit_indicator: 'DBIT',
  status,
  booking_date: '2026-11-09',
})

describe('syncConnection', () => {
  it('reads 90 days the first time and stores balance and transactions', async () => {
    const m = memoryStore()
    const bank = fakeBank([[t('a', '10'), t('b', '20', 'PDNG')]])
    const r = await syncConnection(bank, m.store, conn, { now })
    expect(bank.froms).toEqual(['2026-08-12'])
    expect(r).toEqual({ accounts: 1, inserted: 2, updated: 0 })
    expect(m.balances.get('acc1')).toBe(1234.56)
    expect(m.marks.at(-1)).toEqual({
      id: 'c1',
      patch: { status: 'active', last_synced_at: now.toISOString(), last_error: null },
    })
  })

  it('overlaps the last sync and drops pending payments that were booked', async () => {
    const m = memoryStore()
    await syncConnection(fakeBank([[t('b', '20', 'PDNG')]]), m.store, conn, { now })
    const bank = fakeBank([[t('b', '20')]])
    const r = await syncConnection(
      bank,
      m.store,
      { ...conn, last_synced_at: now.toISOString() },
      { now },
    )
    expect(bank.froms).toEqual(['2026-10-31'])
    expect(r.inserted).toBe(1)
    expect([...m.tx.keys()]).toEqual(['b'])
  })

  it('marks an expired consent without calling the bank', async () => {
    const m = memoryStore()
    const bank = fakeBank([])
    await syncConnection(bank, m.store, { ...conn, valid_until: '2026-11-01T00:00:00Z' }, { now })
    expect(bank.froms).toEqual([])
    expect(m.marks[0]!.patch).toMatchObject({ status: 'expired' })
  })

  it('records errors, and syncMany carries on with the next connection', async () => {
    const m = memoryStore()
    const bank = fakeBank([])
    bank.balances = async () => {
      throw new EnableBankingError(401, 'Enable Banking 401: expired', { error: 'EXPIRED_SESSION' })
    }
    const summary = await syncMany(bank, m.store, [conn, { ...conn, id: 'c2' }], { now })
    expect(summary.errors.map((e) => e.connectionId)).toEqual(['c1', 'c2'])
    expect(m.marks[0]!.patch).toMatchObject({ status: 'expired' })
  })
})
