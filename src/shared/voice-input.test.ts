import { describe, expect, it } from 'vitest'
import { holdMsFor, isOverlayEvent } from './voice-input'

describe('holdMsFor', () => {
  it('is the base duration plus a beat per word', () => {
    expect(holdMsFor('did it pass')).toBe(1400 + 3 * 40)
  })

  it('grows with word count', () => {
    expect(holdMsFor('one two three four five')).toBeGreaterThan(holdMsFor('one two'))
  })

  it('caps so nothing becomes furniture', () => {
    expect(holdMsFor(new Array(200).fill('word').join(' '))).toBe(4000)
  })

  it('handles an empty transcript without counting a phantom word', () => {
    expect(holdMsFor('   ')).toBe(1400)
  })

  it('is not confused by runs of whitespace', () => {
    expect(holdMsFor('one   two')).toBe(holdMsFor('one two'))
  })
})

describe('isOverlayEvent', () => {
  it('accepts each observation the overlay is allowed to report', () => {
    for (const type of ['speechStarted', 'silence', 'noSpeech', 'maxDuration']) {
      expect(isOverlayEvent({ type })).toBe(true)
    }
  })

  it('accepts a failure carrying its message', () => {
    expect(isOverlayEvent({ type: 'failed', message: 'Microphone access was denied' })).toBe(true)
  })

  it('rejects a failure with no message, which would render as a blank error', () => {
    expect(isOverlayEvent({ type: 'failed' })).toBe(false)
  })

  it('rejects events the overlay has no business sending', () => {
    // The reducer understands these; the overlay may not originate them.
    expect(isOverlayEvent({ type: 'trigger', agentId: 'atlas' })).toBe(false)
    expect(isOverlayEvent({ type: 'transcript', text: 'ship it' })).toBe(false)
  })

  it('rejects values that are not events at all', () => {
    expect(isOverlayEvent(null)).toBe(false)
    expect(isOverlayEvent('silence')).toBe(false)
    expect(isOverlayEvent({})).toBe(false)
  })
})
