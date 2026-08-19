import { describe, expect, it } from 'vitest'
import { wakeAction } from './wake-refresh'

/**
 * The decision `refreshWake` makes, lifted out of the composition root.
 *
 * It lived in `index.ts`, which runs `app.whenReady()` at module scope and so
 * can never be imported by a test — which is how a real bug sat in it
 * unguarded.
 */

const ready = { enabled: true, modelInstalled: true, listening: false, deviceChanged: false }

describe('wakeAction', () => {
  it('starts listening when wake words are on and the model is there', () => {
    expect(wakeAction(ready)).toBe('start')
  })

  it('does nothing when it is already in the state asked for', () => {
    expect(wakeAction({ ...ready, listening: true })).toBe('none')
    expect(wakeAction({ ...ready, enabled: false })).toBe('none')
  })

  it('stops when wake words are switched off', () => {
    expect(wakeAction({ ...ready, enabled: false, listening: true })).toBe('stop')
  })

  it('will not start without the speech model', () => {
    // Holding the microphone open with nothing to transcribe is pure cost.
    expect(wakeAction({ ...ready, modelInstalled: false })).toBe('none')
    expect(wakeAction({ ...ready, modelInstalled: false, listening: true })).toBe('stop')
  })

  it('restarts a running listener when the microphone changed', () => {
    // The regression this exists for. A new device id only applies to the
    // next stream opened, so a listener already running keeps hearing the old
    // microphone — while the settings meter, which does reopen, reports the
    // new one working. That pair is a confident, wrong answer.
    expect(wakeAction({ ...ready, listening: true, deviceChanged: true })).toBe('restart')
  })

  it('does not restart a listener that is not running', () => {
    expect(wakeAction({ ...ready, deviceChanged: true })).toBe('start')
  })

  it('ignores a device change when wake words are off', () => {
    expect(wakeAction({ ...ready, enabled: false, deviceChanged: true })).toBe('none')
    expect(wakeAction({ ...ready, enabled: false, listening: true, deviceChanged: true })).toBe(
      'stop'
    )
  })
})
