// The `bank` edge function: list banks, start a bank connection, finish it when
// the bank sends the person back, and disconnect. Called by signed-in members.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@hml/shared/database'
import type { Aspsp, BankRequest, CompleteResponse, StartResponse } from '@hml/shared'
import { HttpError, json, withHttp } from './http.ts'
import { createEnableBanking, type EnableBanking } from './enablebanking.ts'
import { accountName } from './mapping.ts'
import { supabaseStore, type ServiceClient } from './supabaseStore.ts'
import { syncConnection, syncMany, type SyncConnection } from './sync.ts'

export interface BankEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  enableBankingAppId?: string
  enableBankingPrivateKey?: string
  /** Allowed prefixes for the redirect back from the bank (the app's URLs). */
  allowedRedirects?: string[]
  fetch?: typeof fetch
}

/** PSD2 consents last at most 180 days; some banks give less. */
export const MAX_CONSENT_DAYS = 180

export function makeBank(env: BankEnv): EnableBanking {
  if (!env.enableBankingAppId || !env.enableBankingPrivateKey) {
    throw new HttpError(
      503,
      'Bank sync is not set up: ENABLE_BANKING_APP_ID and ENABLE_BANKING_PRIVATE_KEY are missing.',
    )
  }
  return createEnableBanking({
    appId: env.enableBankingAppId,
    privateKeyPem: env.enableBankingPrivateKey,
    fetch: env.fetch,
  })
}

export function serviceClient(env: BankEnv): ServiceClient {
  return createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** The signed-in user behind the request, or a 401. */
export async function requireUser(env: BankEnv, req: Request): Promise<{ id: string }> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Sign in first')
  const client = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Sign in first')
  return { id: data.user.id }
}

export async function requireMember(db: ServiceClient, householdId: string, userId: string) {
  const { data } = await db
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) throw new HttpError(403, 'Not a member of this household')
}

export function psuFrom(req: Request) {
  return {
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  }
}

export function redirectAllowed(url: string, allowed: string[] | undefined): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !local) return false
  if (!allowed?.length) return true
  return allowed.some((prefix) => url.startsWith(prefix))
}

/** Ends a consent at the bank (best effort) and marks it disconnected; its accounts and history stay. */
async function retire(db: ServiceClient, bank: EnableBanking, connectionId: string) {
  const { data: secret } = await db
    .from('bank_connection_secrets')
    .select('session_id')
    .eq('connection_id', connectionId)
    .maybeSingle()
  if (secret?.session_id) {
    await bank.deleteSession(secret.session_id).catch((e) => console.error('deleteSession', e))
  }
  await db.from('bank_connection_secrets').delete().eq('connection_id', connectionId)
  await db.from('bank_connections').update({ status: 'revoked' }).eq('id', connectionId)
}

/** Connections due for a sync, with their session ids. */
export async function syncableConnections(
  db: ServiceClient,
  householdId?: string,
): Promise<SyncConnection[]> {
  let q = db.from('bank_connections').select('*').in('status', ['active', 'error'])
  if (householdId) q = q.eq('household_id', householdId)
  const { data: connections, error } = await q
  if (error) throw new Error(error.message)
  if (!connections?.length) return []
  const { data: secrets, error: secretErr } = await db
    .from('bank_connection_secrets')
    .select('connection_id, session_id')
    .in(
      'connection_id',
      connections.map((c) => c.id),
    )
  if (secretErr) throw new Error(secretErr.message)
  const sessions = new Map((secrets ?? []).map((s) => [s.connection_id, s.session_id]))
  return connections
    .map((c) => ({ ...c, session_id: sessions.get(c.id) ?? null }))
    .filter((c) => c.session_id)
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function createBankHandler(env: BankEnv) {
  return withHttp(async (req) => {
    const user = await requireUser(env, req)
    const body = (await req.json().catch(() => null)) as BankRequest | null
    if (!body || typeof body !== 'object' || !('action' in body)) {
      throw new HttpError(400, 'Missing action')
    }
    const db = serviceClient(env)
    const bank = makeBank(env)

    switch (body.action) {
      case 'aspsps': {
        const list = await bank.aspsps(body.country ?? 'PL')
        const aspsps: Aspsp[] = list
          .map((a) => ({
            name: a.name,
            country: a.country,
            logo: a.logo,
            maximum_consent_validity: a.maximum_consent_validity,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
        return json({ aspsps })
      }

      case 'start': {
        await requireMember(db, body.householdId, user.id)
        if (!body.aspsp?.name || !body.aspsp.country) throw new HttpError(400, 'Pick a bank')
        if (!redirectAllowed(body.redirectUrl, env.allowedRedirects)) {
          throw new HttpError(400, 'Redirect URL not allowed')
        }
        // The longest consent the bank allows, capped at 180 days.
        const info = (await bank.aspsps(body.aspsp.country)).find((a) => a.name === body.aspsp.name)
        const maxSeconds = Math.min(
          info?.maximum_consent_validity ?? 90 * 86_400,
          MAX_CONSENT_DAYS * 86_400,
        )
        const validUntil = new Date(Date.now() + (maxSeconds - 600) * 1000).toISOString()
        const state = randomState()
        const { data: conn, error } = await db
          .from('bank_connections')
          .insert({
            household_id: body.householdId,
            created_by: user.id,
            aspsp_name: body.aspsp.name,
            aspsp_country: body.aspsp.country,
            status: 'pending',
            valid_until: validUntil,
          })
          .select('id')
          .single()
        if (error || !conn) throw new Error(error?.message ?? 'insert failed')
        try {
          const { error: secretErr } = await db
            .from('bank_connection_secrets')
            .insert({ connection_id: conn.id, auth_state: state })
          if (secretErr) throw new Error(secretErr.message)
          const { url } = await bank.startAuthorization({
            aspsp: body.aspsp,
            state,
            redirectUrl: body.redirectUrl,
            validUntil,
          })
          return json({ url, connectionId: conn.id } satisfies StartResponse)
        } catch (e) {
          await db.from('bank_connections').delete().eq('id', conn.id)
          throw e
        }
      }

      case 'complete': {
        if (!body.code || !body.state) throw new HttpError(400, 'Missing code')
        const { data: secret } = await db
          .from('bank_connection_secrets')
          .select('connection_id')
          .eq('auth_state', body.state)
          .maybeSingle()
        const { data: conn } = secret
          ? await db
              .from('bank_connections')
              .select('*')
              .eq('id', secret.connection_id)
              .maybeSingle()
          : { data: null }
        if (!conn) throw new HttpError(404, 'This bank sign-in has expired. Start again.')
        await requireMember(db, conn.household_id, user.id)
        if (conn.created_by !== user.id) {
          throw new HttpError(403, 'Finish the bank sign-in as the person who started it')
        }
        const session = await bank.createSession(body.code)
        const validUntil = session.access?.valid_until ?? conn.valid_until
        const { error: updErr } = await db
          .from('bank_connections')
          .update({ status: 'active', valid_until: validUntil, last_error: null })
          .eq('id', conn.id)
        if (updErr) throw new Error(updErr.message)
        const { error: secretErr } = await db
          .from('bank_connection_secrets')
          .update({ session_id: session.session_id, auth_state: null })
          .eq('connection_id', conn.id)
        if (secretErr) throw new Error(secretErr.message)
        // A reconnect replaces an older consent for the same bank: retire it.
        const { data: older } = await db
          .from('bank_connections')
          .select('id')
          .eq('household_id', conn.household_id)
          .eq('aspsp_name', conn.aspsp_name)
          .neq('id', conn.id)
          .in('status', ['active', 'expired', 'error'])
        for (const o of older ?? []) await retire(db, bank, o.id)

        for (const a of session.accounts ?? []) {
          const row = {
            household_id: conn.household_id,
            connection_id: conn.id,
            external_uid: a.uid,
            owner_id: user.id,
            name: accountName(a),
            iban: a.account_id?.iban?.replace(/\s+/g, '') ?? null,
            currency: a.currency ?? 'PLN',
          }
          // Reconnecting the same bank gives new uids; adopt the old account with that IBAN.
          const { data: existing } = row.iban
            ? await db
                .from('accounts')
                .select('id')
                .eq('household_id', conn.household_id)
                .eq('iban', row.iban)
                .maybeSingle()
            : { data: null }
          const { error: accErr } = existing
            ? await db
                .from('accounts')
                .update({ connection_id: conn.id, external_uid: a.uid })
                .eq('id', existing.id)
            : await db.from('accounts').upsert(row, { onConflict: 'external_uid' })
          if (accErr) throw new Error(accErr.message)
        }

        const { data: fresh } = await db
          .from('bank_connections')
          .select('*')
          .eq('id', conn.id)
          .single()
        // The first sync right away, with the person present (no daily limit applies).
        if (fresh) {
          const withSession = { ...fresh, session_id: session.session_id }
          await syncConnection(bank, supabaseStore(db), withSession, { psu: psuFrom(req) }).catch(
            (e) => console.error('first sync failed', e),
          )
        }
        return json({
          connectionId: conn.id,
          accounts: session.accounts?.length ?? 0,
        } satisfies CompleteResponse)
      }

      case 'disconnect': {
        const { data: conn } = await db
          .from('bank_connections')
          .select('*')
          .eq('id', body.connectionId)
          .maybeSingle()
        if (!conn) throw new HttpError(404, 'Not found')
        await requireMember(db, conn.household_id, user.id)
        await retire(db, bank, conn.id)
        return json({ ok: true })
      }

      default:
        throw new HttpError(400, 'Unknown action')
    }
  })
}

export interface BankSyncEnv extends BankEnv {
  cronSecret?: string
}

/**
 * The `bank-sync` edge function. With the cron secret it syncs every active
 * connection (the daily GitHub Action); with a member's token it syncs that
 * household, telling the bank a person is present.
 */
export function createBankSyncHandler(env: BankSyncEnv) {
  return withHttp(async (req) => {
    const db = serviceClient(env)
    const cron = req.headers.get('x-cron-secret')
    let householdId: string | undefined
    let psu: ReturnType<typeof psuFrom> | undefined
    if (cron) {
      if (!env.cronSecret || cron !== env.cronSecret) throw new HttpError(401, 'Bad cron secret')
    } else {
      const user = await requireUser(env, req)
      const body = (await req.json().catch(() => null)) as { householdId?: string } | null
      if (!body?.householdId) throw new HttpError(400, 'Missing householdId')
      await requireMember(db, body.householdId, user.id)
      householdId = body.householdId
      psu = psuFrom(req)
    }

    const bank = makeBank(env)
    const connections = await syncableConnections(db, householdId)
    return json(await syncMany(bank, supabaseStore(db), connections, { psu }))
  })
}
