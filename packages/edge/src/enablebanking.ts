// A small client for the Enable Banking API (https://enablebanking.com/docs/api/reference/),
// a licensed PSD2 aggregator that covers Polish banks such as Bank Millennium and
// ING Bank Śląski. Every request carries a short-lived JWT signed (RS256) with the
// application's private key; the key never leaves the edge function's secrets.

export const ENABLE_BANKING_API = 'https://api.enablebanking.com'

export interface EnableBankingConfig {
  /** The application id from the Enable Banking control panel (the key's "kid"). */
  appId: string
  /** The application's private key, PEM ("-----BEGIN PRIVATE KEY-----"). */
  privateKeyPem: string
  baseUrl?: string
  fetch?: typeof fetch
  /** Seconds since epoch; tests pin it. */
  now?: () => number
}

export interface Amount {
  currency: string
  amount: string
}

export interface EbAccount {
  uid: string
  account_id?: { iban?: string; other?: { identification?: string } }
  name?: string | null
  product?: string | null
  details?: string | null
  currency?: string
  cash_account_type?: string
}

export interface EbBalance {
  name?: string
  balance_amount: Amount
  balance_type: string
  reference_date?: string | null
  last_change_date_time?: string | null
}

export interface EbTransaction {
  entry_reference?: string | null
  transaction_id?: string | null
  transaction_amount: Amount
  credit_debit_indicator: 'CRDT' | 'DBIT'
  status?: string
  booking_date?: string | null
  value_date?: string | null
  transaction_date?: string | null
  creditor?: { name?: string | null } | null
  creditor_account?: { iban?: string | null } | null
  debtor?: { name?: string | null } | null
  debtor_account?: { iban?: string | null } | null
  remittance_information?: string[] | null
  bank_transaction_code?: { description?: string | null } | null
  merchant_category_code?: string | null
  note?: string | null
}

export interface EbAspsp {
  name: string
  country: string
  logo?: string
  maximum_consent_validity?: number
  psu_types?: string[]
}

export interface StartAuthorizationRequest {
  aspsp: { name: string; country: string }
  state: string
  redirectUrl: string
  validUntil: string
}

export interface EbSession {
  session_id: string
  accounts: EbAccount[]
  access?: { valid_until?: string }
}

/** Who is asking: when a person is at the screen, banks don't count the call against the 4-a-day limit. */
export interface PsuContext {
  ipAddress?: string
  userAgent?: string
}

export class EnableBankingError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message)
  }

  /** The consent is gone: the person has to connect the bank again. */
  get consentEnded(): boolean {
    const text = JSON.stringify(this.body ?? '').toUpperCase()
    return (
      (this.status === 401 || this.status === 403 || this.status === 422) &&
      /EXPIRED|REVOKED|CLOSED|INVALID_SESSION|SESSION/.test(text)
    )
  }
}

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  let bin = ''
  for (const b of raw) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) {
    throw new Error(
      'ENABLE_BANKING_PRIVATE_KEY is a PKCS#1 key; convert it with `openssl pkcs8 -topk8 -nocrypt -in key.pem`',
    )
  }
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** The bearer token: RS256, kid = application id, valid for an hour (the API allows up to 24 h). */
export async function signJwt(appId: string, key: CryptoKey, nowSeconds: number): Promise<string> {
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }))
  const payload = base64url(
    JSON.stringify({
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  )
  const data = `${header}.${payload}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))
  return `${data}.${base64url(new Uint8Array(sig))}`
}

export function createEnableBanking(config: EnableBankingConfig) {
  const baseUrl = config.baseUrl ?? ENABLE_BANKING_API
  const doFetch = config.fetch ?? fetch
  const now = config.now ?? (() => Math.floor(Date.now() / 1000))
  let keyPromise: Promise<CryptoKey> | undefined
  let token: { value: string; exp: number } | undefined

  async function bearer(): Promise<string> {
    const t = now()
    if (token && token.exp - 300 > t) return token.value
    keyPromise ??= importPrivateKey(config.privateKeyPem)
    const value = await signJwt(config.appId, await keyPromise, t)
    token = { value, exp: t + 3600 }
    return value
  }

  async function call<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string | undefined>; psu?: PsuContext } = {},
  ): Promise<T> {
    const url = new URL(path, baseUrl)
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await bearer()}`,
      Accept: 'application/json',
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.psu?.ipAddress) headers['Psu-Ip-Address'] = opts.psu.ipAddress
    if (opts.psu?.userAgent) headers['Psu-User-Agent'] = opts.psu.userAgent
    const res = await doFetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      // keep the text
    }
    if (!res.ok) {
      const detail =
        (parsed as { message?: string; error?: string } | null)?.message ??
        (parsed as { error?: string } | null)?.error ??
        text.slice(0, 200)
      throw new EnableBankingError(res.status, `Enable Banking ${res.status}: ${detail}`, parsed)
    }
    return parsed as T
  }

  return {
    async aspsps(country: string): Promise<EbAspsp[]> {
      const r = await call<{ aspsps: EbAspsp[] }>('GET', '/aspsps', {
        query: { country, psu_type: 'personal' },
      })
      return r.aspsps ?? []
    },

    /** Returns the bank's sign-in page; the bank sends the person back to redirectUrl?code=…&state=…. */
    async startAuthorization(req: StartAuthorizationRequest): Promise<{ url: string }> {
      return call<{ url: string }>('POST', '/auth', {
        body: {
          access: { valid_until: req.validUntil },
          aspsp: req.aspsp,
          state: req.state,
          redirect_url: req.redirectUrl,
          psu_type: 'personal',
        },
      })
    },

    createSession(code: string): Promise<EbSession> {
      return call<EbSession>('POST', '/sessions', { body: { code } })
    },

    async deleteSession(sessionId: string): Promise<void> {
      await call('DELETE', `/sessions/${encodeURIComponent(sessionId)}`)
    },

    async balances(accountUid: string, psu?: PsuContext): Promise<EbBalance[]> {
      const r = await call<{ balances: EbBalance[] }>(
        'GET',
        `/accounts/${encodeURIComponent(accountUid)}/balances`,
        { psu },
      )
      return r.balances ?? []
    },

    /** Every page from dateFrom on (bounded, in case a bank keeps handing out keys). */
    async transactions(
      accountUid: string,
      dateFrom: string,
      psu?: PsuContext,
      maxPages = 20,
    ): Promise<EbTransaction[]> {
      const all: EbTransaction[] = []
      let continuationKey: string | undefined
      for (let page = 0; page < maxPages; page++) {
        const r = await call<{ transactions: EbTransaction[]; continuation_key?: string | null }>(
          'GET',
          `/accounts/${encodeURIComponent(accountUid)}/transactions`,
          { query: { date_from: dateFrom, continuation_key: continuationKey }, psu },
        )
        all.push(...(r.transactions ?? []))
        continuationKey = r.continuation_key ?? undefined
        if (!continuationKey) break
      }
      return all
    },
  }
}

export type EnableBanking = ReturnType<typeof createEnableBanking>
