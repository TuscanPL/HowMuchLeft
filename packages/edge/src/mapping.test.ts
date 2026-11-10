import { describe, expect, it } from 'vitest'
import { accountName, mapTransactions, pickBalance } from './mapping.ts'
import type { EbTransaction } from './enablebanking.ts'

describe('pickBalance', () => {
  it('prefers the available balance', () => {
    expect(
      pickBalance([
        { balance_type: 'CLBD', balance_amount: { amount: '100.00', currency: 'PLN' } },
        { balance_type: 'ITAV', balance_amount: { amount: '90.50', currency: 'PLN' } },
      ]),
    ).toEqual({ amount: 90.5, currency: 'PLN' })
  })
  it('takes an unknown type when that is all there is', () => {
    expect(
      pickBalance([{ balance_type: 'XYZ', balance_amount: { amount: '-5', currency: 'PLN' } }]),
    ).toEqual({
      amount: -5,
      currency: 'PLN',
    })
    expect(pickBalance([])).toBeNull()
  })
})

describe('accountName', () => {
  it('falls back to product and the last IBAN digits', () => {
    expect(accountName({ uid: 'u', name: 'Konto 360°' })).toBe('Konto 360°')
    expect(accountName({ uid: 'u', product: 'Konto Direct' })).toBe('Konto Direct')
    expect(accountName({ uid: 'u', account_id: { iban: 'PL61109010140000071219812874' } })).toBe(
      '…2874',
    )
  })
})

const card: EbTransaction = {
  entry_reference: 'E1',
  transaction_amount: { amount: '42.10', currency: 'PLN' },
  credit_debit_indicator: 'DBIT',
  status: 'BOOK',
  booking_date: '2026-11-03',
  creditor: { name: 'BIEDRONKA 123' },
  remittance_information: ['Płatność kartą', '  BIEDRONKA 123 WARSZAWA '],
}

describe('mapTransactions', () => {
  it('signs amounts by direction and keeps the bank id', async () => {
    const [row] = await mapTransactions([card], '2026-11-10')
    expect(row).toEqual({
      external_id: 'E1',
      status: 'booked',
      booked_on: '2026-11-03',
      amount: -42.1,
      currency: 'PLN',
      description: 'Płatność kartą BIEDRONKA 123 WARSZAWA',
      counterparty: 'BIEDRONKA 123',
      counterparty_iban: null,
    })
  })

  it('takes the debtor for money in', async () => {
    const [row] = await mapTransactions(
      [
        {
          transaction_amount: { amount: '6000', currency: 'PLN' },
          credit_debit_indicator: 'CRDT',
          status: 'BOOK',
          value_date: '2026-11-01',
          debtor: { name: 'ACME SP. Z O.O.' },
          debtor_account: { iban: 'PL 6110 9010 1400 0007 1219 8128 74' },
          remittance_information: ['Wynagrodzenie 10/2026'],
        },
      ],
      '2026-11-10',
    )
    expect(row).toMatchObject({
      amount: 6000,
      booked_on: '2026-11-01',
      counterparty: 'ACME SP. Z O.O.',
      counterparty_iban: 'PL61109010140000071219812874',
    })
    expect(row!.external_id).toMatch(/^h:[0-9a-f]{32}:1$/)
  })

  it('tells identical id-less payments apart, stably', async () => {
    const coffee = { ...card, entry_reference: null }
    const a = await mapTransactions([coffee, coffee], '2026-11-10')
    const b = await mapTransactions([coffee, coffee], '2026-11-10')
    expect(a[0]!.external_id).not.toBe(a[1]!.external_id)
    expect(a.map((r) => r.external_id)).toEqual(b.map((r) => r.external_id))
  })

  it('keeps pending payments apart from booked ones', async () => {
    const [row] = await mapTransactions(
      [{ ...card, status: 'PDNG', booking_date: null }],
      '2026-11-10',
    )
    expect(row).toMatchObject({ status: 'pending', external_id: 'p:E1', booked_on: '2026-11-10' })
  })
})
