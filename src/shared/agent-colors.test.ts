import { describe, expect, it } from 'vitest'
import { AGENT_COLORS, AGENT_COLOR_IDS, colorHexFor } from './agent-colors'

describe('colorHexFor', () => {
  it('resolves a known identity colour', () => {
    expect(colorHexFor('amber')).toBe('#f59e0b')
  })

  it('falls back rather than returning undefined', () => {
    expect(colorHexFor('not-a-colour')).toBe('#71717a')
    expect(colorHexFor('')).toBe('#71717a')
  })

  it('resolves every id the config schema accepts', () => {
    // A colour a user can pick but the UI cannot render would paint agents
    // grey with nothing to explain why.
    for (const id of AGENT_COLOR_IDS) {
      expect(colorHexFor(id), id).not.toBe('#71717a')
    }
  })

  it('keeps every identity colour distinct', () => {
    const hexes = AGENT_COLORS.map((c) => c.hex)

    expect(new Set(hexes).size).toBe(hexes.length)
  })
})
