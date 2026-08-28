import { describe, expect, it } from 'vitest'
import { describeLastActive, resolvePageRange, resumeTarget } from './conversation'

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

describe('resumeTarget', () => {
  it('resumes the latest conversation when nothing has been chosen for the agent', () => {
    expect(resumeTarget({ chosen: false, activeId: null, latestId: 'latest' })).toBe('latest')
  })

  it('keeps an explicit choice', () => {
    expect(resumeTarget({ chosen: true, activeId: 'picked', latestId: 'latest' })).toBe('picked')
  })

  it('honours an explicit new conversation rather than resuming over it', () => {
    expect(resumeTarget({ chosen: true, activeId: null, latestId: 'latest' })).toBeNull()
  })

  it('starts fresh when the agent has no conversations yet', () => {
    expect(resumeTarget({ chosen: false, activeId: null, latestId: null })).toBeNull()
  })
})
