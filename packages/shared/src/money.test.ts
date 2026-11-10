import { describe, expect, it } from 'vitest'
import { parseAmount } from './money.ts'

describe('parseAmount', () => {
  it('reads Polish and English formats', () => {
    expect(parseAmount('1 234,56')).toBe(1234.56)
    expect(parseAmount('1234.5')).toBe(1234.5)
    expect(parseAmount('-20 zł')).toBe(-20)
  })
  it('rejects junk', () => {
    expect(parseAmount('12,345,6')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})
