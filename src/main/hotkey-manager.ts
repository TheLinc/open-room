import { globalShortcut } from 'electron'
import type { Agent } from '@shared/agent'
import type { AppSettings } from '@shared/settings'
import { explainAccelerator, isBindableAccelerator } from '@shared/accelerator'
import type { HotkeyBinding, HotkeyFailure } from '@shared/hotkeys'

// Re-exported so main-side callers keep importing them from here.
export type { HotkeyBinding, HotkeyFailure }

/**
 * Owns every global shortcut in the app.
 *
 * Registration fails when another application already holds a combination,
 * and `globalShortcut.register` signals that by returning false rather than
 * throwing. Swallowing it produces a hotkey that silently does nothing, which
 * a user cannot tell apart from a broken feature — so failures are returned
 * for the UI to show against the field that owns them.
 */

/** Registered only for the life of a capture — see `registerEscape`. */
const ESCAPE = 'Escape'

/**
 * The bindings a given configuration asks for.
 *
 * Pure, so the mapping from settings and agents to shortcuts can be checked
 * without touching Electron.
 */
export function bindingsFor(settings: AppSettings, agents: Agent[]): HotkeyBinding[] {
  if (!settings.voiceInputEnabled) return []

  const bindings: HotkeyBinding[] = []
  if (settings.pushToTalkHotkey.trim()) {
    bindings.push({ accelerator: settings.pushToTalkHotkey, agentId: null })
  }

  for (const agent of agents) {
    const hotkey = agent.config.hotkey?.trim()
    if (hotkey) bindings.push({ accelerator: hotkey, agentId: agent.config.id })
  }

  return bindings
}

/**
 * Chords a shortcut field cannot see, caught for it while it records.
 *
 * Windows takes Alt+Space for the window menu before the page gets the key,
 * and the menu then holds every key press after it: measured, Alt+Shift+Space
 * delivered Alt and Shift down to the page and nothing else, and the next
 * chord went nowhere either. A global shortcut fires before the window menu,
 * so these are registered for the life of a recording and handed to the
 * field. The same way PowerToys Run owns Alt+Space.
 */
export const RESERVED_CHORDS = [
  'Alt+Space',
  'Alt+Shift+Space',
  'CommandOrControl+Alt+Space',
  'CommandOrControl+Alt+Shift+Space'
]

export class HotkeyManager {
  private current: HotkeyBinding[] = []
  private reserved: string[] = []

  /** While a shortcut field records: report `RESERVED_CHORDS` as they are pressed. */
  catchReserved(onChord: (accelerator: string) => void): void {
    this.releaseReserved()
    for (const accelerator of RESERVED_CHORDS) {
      if (globalShortcut.isRegistered(accelerator)) continue
      try {
        if (globalShortcut.register(accelerator, () => onChord(accelerator))) {
          this.reserved.push(accelerator)
        }
      } catch {
        // Not registrable here; the field just cannot record that one.
      }
    }
  }

  releaseReserved(): void {
    for (const accelerator of this.reserved) globalShortcut.unregister(accelerator)
    this.reserved = []
  }

  constructor(private readonly onTrigger: (agentId: string | null) => void) {}

  /**
   * Replaces every binding. Returns the ones that could not be registered.
   *
   * A failure never stops the rest: one unavailable combination should cost
   * that one shortcut, not voice input entirely.
   */
  apply(bindings: HotkeyBinding[]): HotkeyFailure[] {
    for (const binding of this.current) {
      if (globalShortcut.isRegistered(binding.accelerator)) {
        globalShortcut.unregister(binding.accelerator)
      }
    }

    this.current = []
    const failures: HotkeyFailure[] = []

    for (const binding of bindings) {
      // Checked before registering, not just in the UI. Config files are
      // hand-editable, and Electron will happily bind a bare letter — which
      // then swallows that key in every application on the machine.
      if (!isBindableAccelerator(binding.accelerator)) {
        failures.push({
          ...binding,
          reason: explainAccelerator(binding.accelerator) ?? 'Not a shortcut this app can register'
        })
        continue
      }

      let ok = false

      try {
        ok = globalShortcut.register(binding.accelerator, () => this.onTrigger(binding.agentId))
      } catch (error) {
        // An accelerator Electron cannot parse throws rather than returning
        // false, and this string was typed by a user.
        failures.push({
          ...binding,
          reason: error instanceof Error ? error.message : 'Not a valid shortcut'
        })
        continue
      }

      if (ok) this.current.push(binding)
      else failures.push({ ...binding, reason: 'Another application is using this shortcut' })
    }

    return failures
  }

  /**
   * Esc cancels a capture, and exists only while one is running.
   *
   * The overlay is `focusable: false` and can never receive a keypress, so
   * cancelling has to come from a global shortcut. Holding Esc permanently
   * would swallow the key for every other application on the machine.
   */
  registerEscape(handler: () => void): void {
    if (globalShortcut.isRegistered(ESCAPE)) return
    globalShortcut.register(ESCAPE, handler)
  }

  unregisterEscape(): void {
    if (globalShortcut.isRegistered(ESCAPE)) globalShortcut.unregister(ESCAPE)
  }

  dispose(): void {
    globalShortcut.unregisterAll()
    this.current = []
  }
}
