import { describe, expect, it } from 'vitest'
import { eventCandidates, eventSpan, eventTotal, localDay } from './events.ts'

describe('localDay', () => {
  it('uses the Warsaw day, not UTC', () => {
    // 23:30 UTC on the 14th is 00:30 on the 15th in Warsaw (winter, UTC+1).
    expect(localDay('2026-11-14T23:30:00Z')).toBe('2026-11-15')
    expect(localDay('2026-11-14T22:30:00Z')).toBe('2026-11-14')
  })
})

describe('eventSpan', () => {
  const started_at = '2026-11-14T18:00:00Z'

  it('covers check-in day to check-out day', () => {
    expect(eventSpan({ started_at, ended_at: '2026-11-15T01:30:00Z' }, '2026-11-20')).toEqual({
      from: '2026-11-14',
      to: '2026-11-15',
      open: false,
      autoClosed: false,
    })
  })
  it('runs to today while checked in', () => {
    expect(eventSpan({ started_at, ended_at: null }, '2026-11-14')).toMatchObject({
      to: '2026-11-14',
      open: true,
    })
    expect(eventSpan({ started_at, ended_at: null }, '2026-11-15')).toMatchObject({
      to: '2026-11-15',
      open: true,
    })
  })
  it('closes by itself at the end of the next day', () => {
    expect(eventSpan({ started_at, ended_at: null }, '2026-11-16')).toEqual({
      from: '2026-11-14',
      to: '2026-11-15',
      open: false,
      autoClosed: true,
    })
  })
})

describe('eventCandidates', () => {
  const event = {
    started_at: '2026-11-14T18:00:00Z',
    ended_at: '2026-11-15T01:00:00Z',
    created_by: 'me',
  }
  const accounts = [
    { id: 'mine', owner_id: 'me' },
    { id: 'hers', owner_id: 'her' },
    { id: 'shared', owner_id: null },
  ]
  const tx = (
    id: string,
    account_id: string,
    booked_on: string,
    event_id: string | null = null,
  ) => ({
    id,
    account_id,
    booked_on,
    amount: -20,
    event_id,
  })

  it('suggests only my untagged charges from the event days', () => {
    const got = eventCandidates(
      event,
      [
        tx('before', 'mine', '2026-11-13'),
        tx('day1', 'mine', '2026-11-14'),
        tx('day2', 'mine', '2026-11-15'),
        tx('after', 'mine', '2026-11-16'),
        tx('hers', 'hers', '2026-11-14'),
        tx('shared', 'shared', '2026-11-14'),
        tx('tagged', 'mine', '2026-11-14', 'other-event'),
      ],
      accounts,
      '2026-11-20',
    )
    expect(got.map((t) => t.id)).toEqual(['day1', 'day2'])
  })
  it('suggests nothing when nobody owns the event', () => {
    expect(
      eventCandidates(
        { ...event, created_by: null },
        [tx('a', 'mine', '2026-11-14')],
        accounts,
        '2026-11-20',
      ),
    ).toEqual([])
  })
})

describe('eventTotal', () => {
  it('nets money paid back against money out', () => {
    expect(eventTotal([-45.5, -30, 20])).toEqual({ spent: 55.5, count: 3, left: null })
  })
  it('compares with the budget', () => {
    expect(eventTotal([-120], 100)).toEqual({ spent: 120, count: 1, left: -20 })
    expect(eventTotal([], 100)).toEqual({ spent: 0, count: 0, left: 100 })
  })
})
