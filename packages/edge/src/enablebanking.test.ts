import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createEnableBanking,
  EnableBankingError,
  importPrivateKey,
  signJwt,
} from './enablebanking.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

function decode(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString())
}

describe('signJwt', () => {
  it('signs an RS256 token the API accepts', async () => {
    const jwt = await signJwt('app-123', await importPrivateKey(pem), 1_800_000_000)
    const [h, p, s] = jwt.split('.')
    expect(decode(h!)).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-123' })
    expect(decode(p!)).toEqual({
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    })
    const verify = createVerify('RSA-SHA256')
    verify.update(`${h}.${p}`)
    expect(verify.verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true)
  })

  it('reads a key pasted with literal \\n', async () => {
    await expect(importPrivateKey(pem.replace(/\n/g, '\\n'))).resolves.toBeDefined()
  })

  it('explains a PKCS#1 key', async () => {
    await expect(importPrivateKey(pkcs1)).rejects.toThrow(/openssl pkcs8/)
  })
})

describe('client', () => {
  function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fn = (async (url: URL | string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init })
      const r = responses.shift() ?? { body: {} }
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
    }) as typeof fetch
    return { fn, calls }
  }

  it('starts authorization with the consent end date and redirect', async () => {
    const f = fakeFetch([{ body: { url: 'https://bank.example/auth' } }])
    const eb = createEnableBanking({ appId: 'a', privateKeyPem: pem, fetch: f.fn })
    const r = await eb.startAuthorization({
      aspsp: { name: 'ING', country: 'PL' },
      state: 's1',
      redirectUrl: 'https://me.github.io/HowMuchLeft/bank-callback.html',
      validUntil: '2027-05-01T00:00:00.000Z',
    })
    expect(r.url).toBe('https://bank.example/auth')
    expect(f.calls[0]!.url).toBe('https://api.enablebanking.com/auth')
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
      access: { valid_until: '2027-05-01T00:00:00.000Z' },
      aspsp: { name: 'ING', country: 'PL' },
      state: 's1',
      redirect_url: 'https://me.github.io/HowMuchLeft/bank-callback.html',
      psu_type: 'personal',
    })
    const headers = f.calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
  })

  it('follows continuation keys and sends PSU headers', async () => {
    const f = fakeFetch([
      { body: { transactions: [{ entry_reference: '1' }], continuation_key: 'k2' } },
      { body: { transactions: [{ entry_reference: '2' }], continuation_key: null } },
    ])
    const eb = createEnableBanking({ appId: 'a', privateKeyPem: pem, fetch: f.fn })
    const txs = await eb.transactions('uid/1', '2026-08-01', {
      ipAddress: '1.2.3.4',
      userAgent: 'UA',
    })
    expect(txs).toHaveLength(2)
    expect(f.calls[0]!.url).toBe(
      'https://api.enablebanking.com/accounts/uid%2F1/transactions?date_from=2026-08-01',
    )
    expect(f.calls[1]!.url).toContain('continuation_key=k2')
    const headers = f.calls[0]!.init.headers as Record<string, string>
    expect(headers['Psu-Ip-Address']).toBe('1.2.3.4')
    expect(headers['Psu-User-Agent']).toBe('UA')
  })

  it('reuses its token until close to expiry', async () => {
    let t = 1_800_000_000
    const f = fakeFetch([
      { body: { balances: [] } },
      { body: { balances: [] } },
      { body: { balances: [] } },
    ])
    const eb = createEnableBanking({ appId: 'a', privateKeyPem: pem, fetch: f.fn, now: () => t })
    await eb.balances('x')
    t += 60
    await eb.balances('x')
    t += 3600
    await eb.balances('x')
    const auth = f.calls.map((c) => (c.init.headers as Record<string, string>).Authorization)
    expect(auth[0]).toBe(auth[1])
    expect(auth[2]).not.toBe(auth[1])
  })

  it('reports an ended consent', async () => {
    const f = fakeFetch([
      { status: 401, body: { error: 'EXPIRED_SESSION', message: 'Session expired' } },
    ])
    const eb = createEnableBanking({ appId: 'a', privateKeyPem: pem, fetch: f.fn })
    const err = await eb.balances('x').catch((e) => e)
    expect(err).toBeInstanceOf(EnableBankingError)
    expect(err.message).toBe('Enable Banking 401: Session expired')
    expect(err.consentEnded).toBe(true)
  })

  it('does not treat a bank outage as an ended consent', () => {
    expect(new EnableBankingError(502, 'x', { error: 'ASPSP_ERROR' }).consentEnded).toBe(false)
  })
})
