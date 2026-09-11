import { describe, expect, it } from 'vitest'
import { describeCheck } from './update-check-line'

const release = { version: '0.4.0', url: 'https://example.invalid/0.4.0', publishedAt: null }

describe('describeCheck', () => {
  it('leads with the new version and names the running one in words', () => {
    expect(describeCheck({ state: 'available', release, checkedAt: 1 }, '0.3.0')).toBe(
      'Version 0.4.0 is available. You have 0.3.0.'
    )
  })

  it('never puts two version numbers back to back', () => {
    const line = describeCheck({ state: 'available', release, checkedAt: 1 }, '0.3.0')
    expect(line).not.toMatch(/\d\.\s+\d/)
  })

  it('says the running version is current', () => {
    expect(describeCheck({ state: 'current', checkedAt: 1 }, '0.4.0')).toBe(
      'Version 0.4.0 is the latest release.'
    )
  })

  it('reports a failed check with its reason', () => {
    expect(describeCheck({ state: 'failed', message: 'offline', checkedAt: 1 }, '0.3.0')).toBe(
      'Could not check: offline. You have 0.3.0.'
    )
  })

  it('shows only the running version before any check', () => {
    expect(describeCheck({ state: 'unchecked' }, '0.3.0')).toBe('You have 0.3.0.')
  })

  it('copes with an unknown running version', () => {
    expect(describeCheck({ state: 'unchecked' }, '')).toBe('')
    expect(describeCheck({ state: 'available', release, checkedAt: 1 }, '')).toBe(
      'Version 0.4.0 is available.'
    )
    expect(describeCheck({ state: 'current', checkedAt: 1 }, '')).toBe(
      'This is the latest release.'
    )
  })
})
