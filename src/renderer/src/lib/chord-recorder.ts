import { acceleratorFromEvent, type KeyChord } from '@shared/accelerator'

/**
 * Recording a shortcut, one key event at a time.
 *
 * The chord is committed when every key has been let go, not on the first
 * key that makes a valid accelerator. Committing on key-down ended the
 * recording at whichever non-modifier landed first, so a chord pressed in a
 * different order ("Space, then Ctrl and Shift") was cut short: the field
 * report was that it "exits before I click all the keys I want". Held keys
 * show as they build up, and letting go is the confirmation.
 */

export type Recorder = {
  /** Physical keys held down right now, by `code`. */
  pressed: readonly string[]
  /** The latest non-modifier key pressed while recording. */
  main: string | null
  /** What would be committed if every key were released now. */
  chord: string | null
  /** What the field shows while keys are held. */
  display: string
}

export const IDLE_RECORDER: Recorder = { pressed: [], main: null, chord: null, display: '' }

function modifiersOf(event: KeyChord): string[] {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  return parts
}

/** Whether `code` is a key an accelerator can end on, rather than a modifier or an unnamed key. */
function isMainKey(code: string): boolean {
  return (
    acceleratorFromEvent({
      code,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false
    }) !== null
  )
}

/**
 * Held keys, less any modifier the event says is no longer down.
 *
 * Windows takes Alt+Space for the window menu before the page sees it, and
 * swallows every key-up of that press with it: measured, Alt+Shift+Space
 * delivered `AltLeft` and `ShiftLeft` down and nothing else. Trusting the
 * key-ups alone left Alt and Shift "held" for good, and no later chord could
 * ever commit. Every key event carries the true modifier state, so it heals.
 */
function stillHeld(pressed: readonly string[], event: KeyChord): string[] {
  return pressed.filter((code) => {
    if (code.startsWith('Control')) return event.ctrlKey
    if (code.startsWith('Shift')) return event.shiftKey
    if (code.startsWith('Alt')) return event.altKey
    if (code.startsWith('Meta') || code.startsWith('OS')) return event.metaKey
    return true
  })
}

export function keyDown(recorder: Recorder, event: KeyChord): Recorder {
  const held = stillHeld(recorder.pressed, event)
  const pressed = held.includes(event.code) ? held : [...held, event.code]
  const main = isMainKey(event.code) ? event.code : recorder.main

  // Built from this event's modifier flags and the main key only while that
  // key is still held: a chord is what is down together. The flags are read
  // one by one: a real KeyboardEvent keeps them as prototype getters, which
  // an object spread silently drops.
  const chord =
    main && pressed.includes(main)
      ? acceleratorFromEvent({
          code: main,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey
        })
      : recorder.chord

  const display = main && pressed.includes(main) ? chord : [...modifiersOf(event), '…'].join('+')
  return { pressed, main, chord, display: display ?? '' }
}

/** Releasing the last key held commits the chord, if one was ever made. */
export function keyUp(
  recorder: Recorder,
  event: KeyChord
): { recorder: Recorder; commit: string | null } {
  const pressed = stillHeld(recorder.pressed, event).filter((code) => code !== event.code)
  if (pressed.length > 0) return { recorder: { ...recorder, pressed }, commit: null }
  // Only modifiers were pressed and released: nothing to commit, keep waiting.
  if (!recorder.chord) return { recorder: IDLE_RECORDER, commit: null }
  return { recorder: IDLE_RECORDER, commit: recorder.chord }
}
