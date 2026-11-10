import { formatMoney, fromIso, type IsoDate } from '@hml/shared'

/** Money in the household's currency, Polish style ("1 234,56 zł"). */
export function money(amount: number | null | undefined, currency = 'PLN'): string {
  return amount == null ? '–' : formatMoney(amount, currency)
}

/** Whole złoty for big headline numbers. */
export function moneyRound(amount: number, currency = 'PLN'): string {
  return formatMoney(Math.round(amount), currency)
}

export function isoToDate(iso: IsoDate): Date {
  return fromIso(iso)
}
