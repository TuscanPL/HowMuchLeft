// The bank handlers against the local Supabase stack (`supabase start`), with a
// fake Enable Banking. Skipped when the stack isn't running.
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@hml/shared/database'
import { createBankHandler, createBankSyncHandler, redirectAllowed } from './bank.ts'

const url = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'
// The local stack's well-known demo keys.
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const up = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } })
  .then((r) => r.ok)
  .catch(() => false)

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()

/** A stand-in for api.enablebanking.com: one bank, one account, a few payments. */
function fakeEnableBanking() {
  const calls: string[] = []
  let transactions = [
    {
      entry_reference: 'T1',
      transaction_amount: { amount: '84.37', currency: 'PLN' },
      credit_debit_indicator: 'DBIT',
      status: 'BOOK',
      booking_date: new Date().toISOString().slice(0, 10),
      creditor: { name: 'BIEDRONKA' },
      remittance_information: ['Płatność kartą BIEDRONKA 1234'],
    },
    {
      entry_reference: 'T2',
      transaction_amount: { amount: '20.00', currency: 'PLN' },
      credit_debit_indicator: 'DBIT',
      status: 'PDNG',
      booking_date: new Date().toISOString().slice(0, 10),
      remittance_information: ['ZABKA'],
    },
  ]
  const fetchFn = (async (input: URL | string, init: RequestInit = {}) => {
    const u = new URL(String(input))
    calls.push(`${init.method ?? 'GET'} ${u.pathname}`)
    const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (u.pathname === '/aspsps')
      return body({
        aspsps: [
          { name: 'ING', country: 'PL', maximum_consent_validity: 15_552_000 },
          { name: 'Millennium', country: 'PL', maximum_consent_validity: 7_776_000 },
        ],
      })
    if (u.pathname === '/auth') {
      const req = JSON.parse(String(init.body))
      return body({ url: `https://bank.test/login?state=${req.state}` })
    }
    if (u.pathname === '/sessions' && init.method === 'POST')
      return body({
        session_id: 'sess-1',
        access: { valid_until: new Date(Date.now() + 80 * 86_400_000).toISOString() },
        accounts: [
          {
            uid: `acc-${Date.now()}`,
            account_id: { iban: 'PL99109010140000071219812874' },
            name: 'Konto Direct',
            currency: 'PLN',
          },
        ],
      })
    if (u.pathname.startsWith('/sessions/') && init.method === 'DELETE') return body({})
    if (u.pathname.endsWith('/balances'))
      return body({
        balances: [
          { balance_type: 'ITAV', balance_amount: { amount: '1000.00', currency: 'PLN' } },
        ],
      })
    if (u.pathname.endsWith('/transactions')) return body({ transactions, continuation_key: null })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return {
    fetchFn,
    calls,
    setTransactions: (t: typeof transactions) => (transactions = t),
  }
}

describe.skipIf(!up)('bank functions (local stack)', () => {
  const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false } })
  const email = `bank-${Date.now()}@test.local`
  let token = ''
  let householdId = ''
  let userId = ''
  const eb = fakeEnableBanking()
  const env = {
    supabaseUrl: url,
    anonKey,
    serviceRoleKey,
    enableBankingAppId: 'app-1',
    enableBankingPrivateKey: pem,
    allowedRedirects: ['http://localhost:5173/'],
    cronSecret: 'cron',
    fetch: eb.fetchFn,
  }
  const bank = createBankHandler(env)
  const sync = createBankSyncHandler(env)
  const call = (handler: typeof bank, body: unknown, headers: Record<string, string> = {}) =>
    handler(
      new Request('http://x/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    ).then(async (r) => ({ status: r.status, body: await r.json() }))

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'pw-123456',
      email_confirm: true,
    })
    if (error) throw error
    userId = data.user.id
    const client = createClient<Database>(url, anonKey, { auth: { persistSession: false } })
    const { data: s } = await client.auth.signInWithPassword({ email, password: 'pw-123456' })
    token = s.session!.access_token
    const { data: hh } = await client.rpc('create_household', { p_name: 'Bank test' })
    householdId = hh!.id
  })

  afterAll(async () => {
    if (householdId) await admin.from('households').delete().eq('id', householdId)
    if (userId) await admin.auth.admin.deleteUser(userId)
  })

  it('refuses strangers and foreign redirects', async () => {
    const r = await call(bank, { action: 'aspsps' }, { Authorization: 'Bearer nope' })
    expect(r.status).toBe(401)
    const bad = await call(bank, {
      action: 'start',
      householdId,
      aspsp: { name: 'ING', country: 'PL' },
      redirectUrl: 'https://evil.example/',
    })
    expect(bad.status).toBe(400)
    expect(redirectAllowed('http://evil.example/', undefined)).toBe(false)
  })

  it('connects a bank, syncs it, re-syncs without duplicates, and disconnects', async () => {
    const list = await call(bank, { action: 'aspsps', country: 'PL' })
    expect(list.body.aspsps.map((a: { name: string }) => a.name)).toEqual(['ING', 'Millennium'])

    const start = await call(bank, {
      action: 'start',
      householdId,
      aspsp: { name: 'ING', country: 'PL' },
      redirectUrl: 'http://localhost:5173/bank-callback.html',
    })
    expect(start.status).toBe(200)
    const state = new URL(start.body.url).searchParams.get('state')!
    const { data: pending } = await admin
      .from('bank_connections')
      .select('*')
      .eq('id', start.body.connectionId)
      .single()
    expect(pending!.status).toBe('pending')

    const done = await call(bank, { action: 'complete', code: 'code-1', state })
    expect(done.body).toEqual({ connectionId: start.body.connectionId, accounts: 1 })

    const { data: account } = await admin
      .from('accounts')
      .select('*')
      .eq('household_id', householdId)
      .single()
    expect(account).toMatchObject({ name: 'Konto Direct', balance: 1000, owner_id: userId })
    const { data: txs } = await admin
      .from('transactions')
      .select('external_id, amount, status, category_id')
      .eq('household_id', householdId)
      .order('external_id')
    const byId = (a: { external_id: string }, b: { external_id: string }) =>
      a.external_id < b.external_id ? -1 : 1
    expect(txs!.sort(byId).map((t) => [t.external_id, t.amount, t.status])).toEqual([
      ['T1', -84.37, 'booked'],
      ['p:T2', -20, 'pending'],
    ])

    // The pending payment gets booked; categorisation by hand survives.
    const groceries = (
      await admin
        .from('categories')
        .select('id')
        .eq('household_id', householdId)
        .eq('name', 'Groceries')
        .single()
    ).data!.id
    await admin
      .from('transactions')
      .update({ category_id: groceries, manual: true, note: 'weekly shop' })
      .eq('external_id', 'T1')
    eb.setTransactions([
      {
        entry_reference: 'T1',
        transaction_amount: { amount: '84.37', currency: 'PLN' },
        credit_debit_indicator: 'DBIT',
        status: 'BOOK',
        booking_date: new Date().toISOString().slice(0, 10),
        creditor: { name: 'BIEDRONKA' },
        remittance_information: ['Płatność kartą BIEDRONKA 1234'],
      },
      {
        entry_reference: 'T2',
        transaction_amount: { amount: '20.00', currency: 'PLN' },
        credit_debit_indicator: 'DBIT',
        status: 'BOOK',
        booking_date: new Date().toISOString().slice(0, 10),
        remittance_information: ['ZABKA'],
      },
    ])
    const r = await call(sync, { householdId })
    expect(r.body).toMatchObject({
      connections: 1,
      accounts: 1,
      inserted: 1,
      updated: 1,
      errors: [],
    })
    const { data: after } = await admin
      .from('transactions')
      .select('external_id, status, category_id, note')
      .eq('household_id', householdId)
      .order('external_id')
    expect(after!.sort(byId)).toEqual([
      { external_id: 'T1', status: 'booked', category_id: groceries, note: 'weekly shop' },
      { external_id: 'T2', status: 'booked', category_id: null, note: null },
    ])

    // The daily job uses the cron secret instead of a user.
    const cron = await sync(
      new Request('http://x/', { method: 'POST', headers: { 'x-cron-secret': 'cron' } }),
    )
    expect(cron.status).toBe(200)
    const wrong = await sync(
      new Request('http://x/', { method: 'POST', headers: { 'x-cron-secret': 'nope' } }),
    )
    expect(wrong.status).toBe(401)

    const off = await call(bank, { action: 'disconnect', connectionId: start.body.connectionId })
    expect(off.status).toBe(200)
    expect(eb.calls).toContain('DELETE /sessions/sess-1')
    const { data: conn } = await admin
      .from('bank_connections')
      .select('status')
      .eq('id', start.body.connectionId)
      .single()
    expect(conn!.status).toBe('revoked')
    const { count } = await admin
      .from('bank_connection_secrets')
      .select('*', { count: 'exact', head: true })
      .eq('connection_id', start.body.connectionId)
    expect(count).toBe(0)
  })
})
