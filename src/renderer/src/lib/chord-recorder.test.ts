import { describe, expect, it } from 'vitest'
import { IDLE_RECORDER, keyDown, keyUp, type Recorder } from './chord-recorder'

type Step = ['down' | 'up', string, ...('ctrl' | 'alt' | 'shift')[]]

/** Replays key events; returns the first commit and the recorder at the end. */
function play(steps: Step[]): { commit: string | null; recorder: Recorder; commitAt: number } {
  let recorder = IDLE_RECORDER
  for (const [i, [kind, code, ...mods]] of steps.entries()) {
    const event = {
      code,
      ctrlKey: mods.includes('ctrl'),
      metaKey: false,
      altKey: mods.includes('alt'),
      shiftKey: mods.includes('shift')
    }
    if (kind === 'down') {
      recorder = keyDown(recorder, event)
      continue
    }
    const result = keyUp(recorder, event)
    recorder = result.recorder
    if (result.commit) return { commit: result.commit, recorder, commitAt: i }
  }
  return { commit: null, recorder, commitAt: -1 }
}

describe('chord recorder', () => {
  it('records a chord pressed modifiers first, on release', () => {
    const { commit } = play([
      ['down', 'ControlLeft', 'ctrl'],
      ['down', 'ShiftLeft', 'ctrl', 'shift'],
      ['down', 'Space', 'ctrl', 'shift'],
      ['up', 'Space', 'ctrl', 'shift'],
      ['up', 'ShiftLeft', 'ctrl'],
      ['up', 'ControlLeft']
    ])
    expect(commit).toBe('CommandOrControl+Shift+Space')
  })

  it('does not end the recording while any key is still held', () => {
    // The old field committed on this first key-down and stopped listening.
    const { commit, commitAt } = play([
      ['down', 'ShiftLeft', 'shift'],
      ['down', 'KeyA', 'shift'],
      ['down', 'ControlLeft', 'ctrl', 'shift'],
      ['up', 'KeyA', 'ctrl', 'shift'],
      ['up', 'ControlLeft', 'shift'],
      ['up', 'ShiftLeft']
    ])
    expect(commit).toBe('CommandOrControl+Shift+A')
    expect(commitAt).toBe(5)
  })

  it('takes modifiers added after the main key', () => {
    const { commit } = play([
      ['down', 'Space'],
      ['down', 'AltLeft', 'alt'],
      ['up', 'AltLeft'],
      ['up', 'Space']
    ])
    expect(commit).toBe('Alt+Space')
  })

  it('keeps waiting when only modifiers were pressed and released', () => {
    const { commit, recorder } = play([
      ['down', 'ControlLeft', 'ctrl'],
      ['up', 'ControlLeft']
    ])
    expect(commit).toBeNull()
    expect(recorder).toEqual(IDLE_RECORDER)
  })

  it('shows the modifiers held while the chord is still being built', () => {
    const recorder = keyDown(keyDown(IDLE_RECORDER, chord('ControlLeft', true)), {
      ...chord('ShiftLeft', true),
      shiftKey: true
    })
    expect(recorder.display).toBe('CommandOrControl+Shift+…')
  })

  it('reads modifiers a real KeyboardEvent keeps as getters', () => {
    // Measured in the app: spreading the event lost every modifier and
    // Ctrl+Shift+A was saved as a bare "A".
    class Held {
      constructor(readonly code: string) {}
      get ctrlKey(): boolean {
        return true
      }
      get metaKey(): boolean {
        return false
      }
      get altKey(): boolean {
        return false
      }
      get shiftKey(): boolean {
        return true
      }
    }
    const recorder = keyDown(keyDown(IDLE_RECORDER, new Held('ShiftLeft')), new Held('KeyA'))
    expect(keyUp(recorder, new Held('KeyA')).commit).toBeNull()
    expect(recorder.chord).toBe('CommandOrControl+Shift+A')
  })

  it('recovers when Windows swallows the rest of an Alt+Space press', () => {
    // Measured: Alt+Shift+Space delivered these two key-downs and nothing
    // else, no Space and no key-ups. The next chord must still commit.
    const { commit } = play([
      ['down', 'AltLeft', 'alt'],
      ['down', 'ShiftLeft', 'alt', 'shift'],
      ['down', 'ControlLeft', 'ctrl'],
      ['down', 'KeyK', 'ctrl'],
      ['up', 'KeyK', 'ctrl'],
      ['up', 'ControlLeft']
    ])
    expect(commit).toBe('CommandOrControl+K')
  })

  it('uses the last main key pressed while its modifiers stay down', () => {
    const { commit } = play([
      ['down', 'ControlLeft', 'ctrl'],
      ['down', 'KeyA', 'ctrl'],
      ['up', 'KeyA', 'ctrl'],
      ['down', 'KeyB', 'ctrl'],
      ['up', 'KeyB', 'ctrl'],
      ['up', 'ControlLeft']
    ])
    expect(commit).toBe('CommandOrControl+B')
  })
})

function chord(
  code: string,
  ctrlKey = false
): {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
} {
  return { code, ctrlKey, metaKey: false, altKey: false, shiftKey: false }
}
