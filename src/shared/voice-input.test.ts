import { describe, expect, it } from 'vitest'
import { colorHexFor, holdMsFor } from './voice-input'

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

describe('colorHexFor', () => {
  it('resolves a known identity colour', () => {
    expect(colorHexFor('amber')).toBe('#f59e0b')
  })

  it('falls back rather than returning undefined', () => {
    expect(colorHexFor('not-a-colour')).toBe('#71717a')
    expect(colorHexFor('')).toBe('#71717a')
  })
})
