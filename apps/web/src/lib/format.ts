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

/** A timestamp as the value of an <input type="datetime-local"> (this device's time). */
export function toLocalInput(timestamp: string): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Back from an <input type="datetime-local"> to a timestamp. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString()
}
