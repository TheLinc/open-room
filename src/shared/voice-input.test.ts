import { describe, expect, it } from 'vitest'
import { holdMsFor, isOverlayEvent, resolveMicrophone } from './voice-input'

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

describe('resolveMicrophone', () => {
  const devices = [
    { deviceId: 'default', label: 'Default - Microphone (Webcam)' },
    { deviceId: '534c5220', label: 'Microphone (Razer Seiren Mini) (1532:0531)' },
    { deviceId: 'dc349283', label: 'Microphone (Webcam)' }
  ]

  it('resolves a stored label to whatever id this session gave the device', () => {
    // Measured: Chromium re-salts deviceId on every launch of a file:// page,
    // so the id is session-scoped and only the label survives a restart.
    expect(resolveMicrophone(devices, 'Microphone (Razer Seiren Mini) (1532:0531)')).toBe(
      '534c5220'
    )
  })

  it('returns null for the system default, so no constraint is applied', () => {
    expect(resolveMicrophone(devices, '')).toBeNull()
  })

  it('returns null for a device that is no longer present', () => {
    expect(resolveMicrophone(devices, 'Microphone (Arctis 7+) (1038:220e)')).toBeNull()
  })
})
