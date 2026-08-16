import { describe, expect, it } from 'vitest'
import { checkAgentName, countSyllables, namesCollide, phoneticKeys } from './phonetics'

describe('namesCollide', () => {
  // The cases from the design notes: edit distance gets both of these wrong.
  it('catches homophones that differ by one character', () => {
    expect(namesCollide('Sky', 'Skye')).toBe(true)
  })

  it('catches names that differ by more characters but sound identical', () => {
    expect(namesCollide('Atlas', 'Atlass')).toBe(true)
  })

  it('treats acoustically distinct names as safe', () => {
    expect(namesCollide('Atlas', 'Juniper')).toBe(false)
    expect(namesCollide('Atlas', 'Sky')).toBe(false)
  })

  it('is case and punctuation insensitive', () => {
    expect(namesCollide('atlas', 'ATLAS')).toBe(true)
    expect(namesCollide("O'Brien", 'OBrien')).toBe(true)
  })

  it('compares multi-word names word by word', () => {
    expect(namesCollide('Sky Blue', 'Skye Blue')).toBe(true)
    expect(namesCollide('Sky Blue', 'Sky Green')).toBe(false)
  })

  it('does not collide on empty input', () => {
    expect(namesCollide('', 'Atlas')).toBe(false)
    expect(namesCollide('...', 'Atlas')).toBe(false)
  })
})

describe('phoneticKeys', () => {
  it('produces a stable key for the same sound', () => {
    expect(phoneticKeys('Sky')[0]).toBe(phoneticKeys('Skye')[0])
  })

  it('returns empty keys for input with no letters', () => {
    expect(phoneticKeys('123')).toEqual(['', ''])
  })
})

describe('countSyllables', () => {
  it('counts common cases', () => {
    expect(countSyllables('Max')).toBe(1)
    expect(countSyllables('Atlas')).toBe(2)
    expect(countSyllables('Juniper')).toBe(3)
  })

  it('returns 0 for empty input', () => {
    expect(countSyllables('')).toBe(0)
  })
})

describe('checkAgentName', () => {
  it('warns when a name collides with an existing agent', () => {
    const warnings = checkAgentName('Skye', ['Sky', 'Atlas'])
    expect(warnings.map((w) => w.kind)).toContain('collision')
    expect(warnings.find((w) => w.kind === 'collision')?.message).toContain('Sky')
  })

  it('does not warn about colliding with itself when editing', () => {
    const warnings = checkAgentName('Atlas', ['Atlas'])
    expect(warnings.map((w) => w.kind)).not.toContain('collision')
  })

  it('warns on single-syllable names', () => {
    expect(checkAgentName('Max', []).map((w) => w.kind)).toContain('too-short')
  })

  it('warns on names that are common in speech', () => {
    expect(checkAgentName('Ready', []).map((w) => w.kind)).toContain('common-word')
    expect(checkAgentName('Scout Ready', []).map((w) => w.kind)).toContain('common-word')
  })

  it('passes a good wake word cleanly', () => {
    expect(checkAgentName('Juniper', ['Atlas'])).toEqual([])
    expect(checkAgentName('Atlas', ['Juniper'])).toEqual([])
  })

  it('returns nothing for an empty name rather than piling on warnings', () => {
    expect(checkAgentName('   ', ['Atlas'])).toEqual([])
  })
})
