/**
 * Global shortcut bindings and what went wrong with them.
 *
 * Shared rather than main-only because a failed registration has to reach the
 * settings dialog and the agent editor — the two places a user can type a
 * shortcut. A binding that silently does nothing is indistinguishable from a
 * broken feature.
 */

export type HotkeyBinding = {
  accelerator: string
  /** null is the global binding, which targets the selected agent. */
  agentId: string | null
}

export type HotkeyFailure = HotkeyBinding & { reason: string }
