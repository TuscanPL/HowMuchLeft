/** "1 234,56 zł" style amounts for the household's currency. */
export function formatMoney(amount: number, currency = 'PLN', locale = 'pl-PL'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** Parses what people type: "1 234,56", "1234.5", "-20". Returns null for anything else. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[\s ]/g, '').replace(/zł|pln/gi, '')
  if (!/^-?\d+([.,]\d{1,2})?$/.test(cleaned)) return null
  return Number(cleaned.replace(',', '.'))
}
