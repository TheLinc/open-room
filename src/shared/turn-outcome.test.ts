import { describe, expect, it } from 'vitest'
import { turnOutcome } from './turn-outcome'

describe('turnOutcome', () => {
  it('is a success only when the CLI says so and flags no error', () => {
    expect(turnOutcome({ subtype: 'success', is_error: false }, false)).toBe('success')
  })

  it('is an error when the result is flagged, whatever the subtype says', () => {
    // Measured: the CLI reports a failed model lookup, and an expired OAuth
    // token it could not refresh, as `subtype: success` with `is_error: true`
    // and the error sentence in `result`. Read as a success, that sentence
    // was spoken aloud as the agent's closing line.
    expect(turnOutcome({ subtype: 'success', is_error: true }, false)).toBe('error')
    expect(turnOutcome({ subtype: 'error_during_execution', is_error: true }, false)).toBe('error')
  })

  it('is an interrupt when the user asked for the stop, whatever the CLI reports', () => {
    expect(turnOutcome({ subtype: 'error_during_execution', is_error: true }, true)).toBe(
      'interrupted'
    )
  })

  it('treats a missing flag as no error', () => {
    expect(turnOutcome({ subtype: 'success' }, false)).toBe('success')
  })
})
