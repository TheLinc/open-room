import { describe, expect, it } from 'vitest'
import { trayVoiceToggle, voiceActive } from './tray-voice'

describe('trayVoiceToggle', () => {
  it('turns everything off when any voice path is on', () => {
    // The tray item is the panic switch: one gesture must guarantee the
    // microphone is closed, whichever path had it open.
    expect(trayVoiceToggle({ voiceInputEnabled: true, wakeWordEnabled: false })).toEqual({
      next: { voiceInputEnabled: false, wakeWordEnabled: false },
      enabling: false
    })
    expect(trayVoiceToggle({ voiceInputEnabled: false, wakeWordEnabled: true })).toEqual({
      next: { voiceInputEnabled: false, wakeWordEnabled: false },
      enabling: false
    })
    expect(trayVoiceToggle({ voiceInputEnabled: true, wakeWordEnabled: true })).toEqual({
      next: { voiceInputEnabled: false, wakeWordEnabled: false },
      enabling: false
    })
  })

  it('restores only push-to-talk when everything is off', () => {
    // Silently re-arming an always-open microphone from a tray click would
    // be wrong; wake words are re-enabled deliberately, in settings.
    expect(trayVoiceToggle({ voiceInputEnabled: false, wakeWordEnabled: false })).toEqual({
      next: { voiceInputEnabled: true, wakeWordEnabled: false },
      enabling: true
    })
  })
})

describe('voiceActive', () => {
  it('is true when either path is on', () => {
    expect(voiceActive({ voiceInputEnabled: true, wakeWordEnabled: false })).toBe(true)
    expect(voiceActive({ voiceInputEnabled: false, wakeWordEnabled: true })).toBe(true)
    expect(voiceActive({ voiceInputEnabled: false, wakeWordEnabled: false })).toBe(false)
  })
})
