import { describe, expect, it } from 'vitest'
import { autoSelectTarget, describeLastActive, resolvePageRange } from './conversation'

describe('describeLastActive', () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0)
  const ago = (ms: number) => describeLastActive(now - ms, now)

  it('reads naturally at each scale', () => {
    expect(ago(5_000)).toBe('just now')
    expect(ago(60_000)).toBe('1 minute ago')
    expect(ago(120_000)).toBe('2 minutes ago')
    expect(ago(3_600_000)).toBe('1 hour ago')
    expect(ago(7_200_000)).toBe('2 hours ago')
    expect(ago(86_400_000)).toBe('1 day ago')
    expect(ago(3 * 86_400_000)).toBe('3 days ago')
  })

  it('does not report negative time when a clock runs ahead', () => {
    expect(describeLastActive(now + 60_000, now)).toBe('just now')
  })
})

describe('resolvePageRange', () => {
  it('lands on the tail when no offset is given', () => {
    // A chat pane opens at the most recent messages, but the SDK paginates
    // from the start, so the tail has to be computed.
    expect(resolvePageRange(100, { limit: 60 })).toEqual({ start: 40, end: 100 })
  })

  it('returns the whole transcript when it is shorter than a page', () => {
    expect(resolvePageRange(11, { limit: 60 })).toEqual({ start: 0, end: 11 })
  })

  it('walks backwards a page at a time', () => {
    expect(resolvePageRange(100, { limit: 40, offset: 0 })).toEqual({ start: 0, end: 40 })
    expect(resolvePageRange(100, { limit: 40, offset: 40 })).toEqual({ start: 40, end: 80 })
  })

  it('clamps an offset past the end instead of returning a negative slice', () => {
    expect(resolvePageRange(10, { limit: 5, offset: 999 })).toEqual({ start: 10, end: 10 })
  })

  it('clamps a negative offset to the start', () => {
    expect(resolvePageRange(10, { limit: 5, offset: -5 })).toEqual({ start: 0, end: 5 })
  })

  it('handles an empty transcript', () => {
    expect(resolvePageRange(0, { limit: 60 })).toEqual({ start: 0, end: 0 })
  })

  it('never requests a zero-length page', () => {
    expect(resolvePageRange(10, { limit: 0 })).toEqual({ start: 9, end: 10 })
  })
})

describe('autoSelectTarget', () => {
  const base = {
    agentId: 'juno',
    listedFor: 'juno',
    conversations: [{ sessionId: 's-juno', title: 'x', lastModified: 2 }],
    activeId: null,
    state: 'idle' as const,
    alreadyFor: null
  }

  it('lands an idle agent with nothing chosen in its most recent conversation', () => {
    expect(autoSelectTarget(base)).toBe('s-juno')
  })

  it('refuses a list that was loaded for a different agent', () => {
    // The list refreshes asynchronously after the selected agent changes, so
    // for a moment it is the previous agent's. Selecting from it handed one
    // agent another's session — its turn was appended to the other's file.
    expect(autoSelectTarget({ ...base, listedFor: 'atlas' })).toBeNull()
  })

  it('does nothing once a conversation is chosen', () => {
    expect(autoSelectTarget({ ...base, activeId: 's-other' })).toBeNull()
  })

  it('does not touch a working agent', () => {
    expect(autoSelectTarget({ ...base, state: 'working' })).toBeNull()
  })

  it('fires once per agent so it cannot fight a deliberate deselection', () => {
    expect(autoSelectTarget({ ...base, alreadyFor: 'juno' })).toBeNull()
    expect(autoSelectTarget({ ...base, alreadyFor: 'atlas' })).toBe('s-juno')
  })

  it('has nothing to pick from an empty list', () => {
    expect(autoSelectTarget({ ...base, conversations: [] })).toBeNull()
  })
})
