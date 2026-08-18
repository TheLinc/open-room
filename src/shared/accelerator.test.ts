import { describe, expect, it } from 'vitest'
import {
  acceleratorFromEvent,
  explainAccelerator,
  isBindableAccelerator,
  type KeyChord
} from './accelerator'

function press(code: string, modifiers: Partial<KeyChord> = {}): KeyChord {
  return { code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }
}

describe('acceleratorFromEvent', () => {
  it('builds a chord from modifiers and a letter', () => {
    expect(acceleratorFromEvent(press('KeyA', { ctrlKey: true, shiftKey: true }))).toBe(
      'CommandOrControl+Shift+A'
    )
  })

  it('collapses Command and Control to one token', () => {
    // The point of CommandOrControl is that one binding means the same thing
    // on both platforms.
    expect(acceleratorFromEvent(press('KeyK', { metaKey: true }))).toBe('CommandOrControl+K')
    expect(acceleratorFromEvent(press('KeyK', { ctrlKey: true }))).toBe('CommandOrControl+K')
  })

  it('orders modifiers the way Electron documents them', () => {
    const chord = press('KeyJ', { shiftKey: true, altKey: true, ctrlKey: true })

    expect(acceleratorFromEvent(chord)).toBe('CommandOrControl+Alt+Shift+J')
  })

  it('returns null while only a modifier is held', () => {
    // The user is still assembling a chord; this is not a rejection.
    for (const code of ['ControlLeft', 'ShiftRight', 'AltLeft', 'MetaLeft']) {
      expect(acceleratorFromEvent(press(code, { ctrlKey: true }))).toBeNull()
    }
  })

  it('uses the physical key, so layout does not change the result', () => {
    expect(acceleratorFromEvent(press('Digit1', { altKey: true }))).toBe('Alt+1')
  })

  it('names the keys Electron names', () => {
    expect(acceleratorFromEvent(press('Space', { ctrlKey: true, shiftKey: true }))).toBe(
      'CommandOrControl+Shift+Space'
    )
    expect(acceleratorFromEvent(press('Enter', { altKey: true }))).toBe('Alt+Return')
    expect(acceleratorFromEvent(press('ArrowUp', { altKey: true }))).toBe('Alt+Up')
    expect(acceleratorFromEvent(press('F5'))).toBe('F5')
  })

  it('refuses keys Electron has no name for rather than guessing', () => {
    expect(acceleratorFromEvent(press('ContextMenu', { ctrlKey: true }))).toBeNull()
  })
})

describe('isBindableAccelerator', () => {
  it('accepts a modified key', () => {
    expect(isBindableAccelerator('CommandOrControl+Shift+Space')).toBe(true)
    expect(isBindableAccelerator('Alt+A')).toBe(true)
  })

  it('accepts a function key on its own', () => {
    expect(isBindableAccelerator('F8')).toBe(true)
  })

  it('refuses a bare letter, which would be taken from every other app', () => {
    // This is exactly what a plain text field produces when someone presses
    // Ctrl+Shift+A: the modifiers type nothing and only the letter lands.
    expect(isBindableAccelerator('a')).toBe(false)
    expect(isBindableAccelerator('A')).toBe(false)
    expect(isBindableAccelerator('1')).toBe(false)
  })

  it('refuses Escape, which already cancels a recording', () => {
    expect(isBindableAccelerator('Escape')).toBe(false)
    expect(isBindableAccelerator('CommandOrControl+Escape')).toBe(false)
  })

  it('refuses a lone modifier', () => {
    expect(isBindableAccelerator('Shift')).toBe(false)
  })

  it('refuses an unknown modifier', () => {
    expect(isBindableAccelerator('Hyper+A')).toBe(false)
  })

  it('refuses an empty accelerator', () => {
    expect(isBindableAccelerator('')).toBe(false)
  })
})

describe('explainAccelerator', () => {
  it('says nothing about an empty field, which just means no binding', () => {
    expect(explainAccelerator('')).toBeNull()
    expect(explainAccelerator('   ')).toBeNull()
  })

  it('says nothing about a usable accelerator', () => {
    expect(explainAccelerator('CommandOrControl+Alt+1')).toBeNull()
  })

  it('explains why a bare letter is refused', () => {
    expect(explainAccelerator('a')).toMatch(/modifier/i)
  })

  it('explains Escape', () => {
    expect(explainAccelerator('Escape')).toMatch(/cancels/i)
  })
})
