import { globalShortcut } from 'electron'
import type { Agent } from '@shared/agent'
import type { AppSettings } from '@shared/settings'

/**
 * Owns every global shortcut in the app.
 *
 * Registration fails when another application already holds a combination,
 * and `globalShortcut.register` signals that by returning false rather than
 * throwing. Swallowing it produces a hotkey that silently does nothing, which
 * a user cannot tell apart from a broken feature — so failures are returned
 * for the UI to show against the field that owns them.
 */

export type HotkeyBinding = {
  accelerator: string
  /** null is the global binding, which targets the selected agent. */
  agentId: string | null
}

export type HotkeyFailure = HotkeyBinding & { reason: string }

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

export class HotkeyManager {
  private current: HotkeyBinding[] = []

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
