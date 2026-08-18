/**
 * Turning a keypress into an Electron accelerator, and refusing the dangerous
 * ones.
 *
 * Typing an accelerator by hand does not work: pressing Ctrl or Shift produces
 * no character, so a plain text field records only the letter and silently
 * yields a bare `a` — which registers fine and then swallows that key in every
 * application on the machine.
 */

/**
 * `code` is layout-independent, so the physical key a user pressed maps to the
 * same accelerator regardless of their keyboard layout. Only keys Electron
 * actually names are listed; anything absent is refused rather than guessed.
 */
const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
}

/** Modifiers, in the order Electron's own documentation writes them. */
const MODIFIER_ORDER = ['CommandOrControl', 'Alt', 'Shift', 'Super'] as const

function keyNameFor(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return KEY_NAMES[code] ?? null
}

/** A function key is a shortcut on its own; nothing else is. */
function isStandalone(key: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
}

export type KeyChord = {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * The accelerator for a keypress, or null while it cannot be one yet.
 *
 * Returns null for a modifier pressed on its own — that is the user still
 * assembling a chord, not an invalid entry — and for keys Electron has no name
 * for.
 */
export function acceleratorFromEvent(event: KeyChord): string | null {
  const key = keyNameFor(event.code)
  if (key === null) return null

  const parts: string[] = []
  // Command and Control collapse to one token so a binding means the same
  // thing on both platforms, which is the whole point of CommandOrControl.
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  return [...parts, key].join('+')
}

/**
 * Whether an accelerator is safe to register globally.
 *
 * A global shortcut with no modifier takes that key away from every other
 * application, so a bare letter or digit is refused. Escape is refused because
 * it already cancels a running capture.
 */
export function isBindableAccelerator(accelerator: string): boolean {
  const parts = accelerator.split('+').filter(Boolean)
  if (parts.length === 0) return false

  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (MODIFIER_ORDER.some((modifier) => modifier === key)) return false
  if (!modifiers.every((modifier) => MODIFIER_ORDER.some((known) => known === modifier))) {
    return false
  }

  if (key === 'Escape') return false
  return modifiers.length > 0 || isStandalone(key)
}

/** Why an accelerator was refused, for a field to show. */
export function explainAccelerator(accelerator: string): string | null {
  if (!accelerator.trim()) return null
  if (isBindableAccelerator(accelerator)) return null

  const parts = accelerator.split('+').filter(Boolean)
  if (parts[parts.length - 1] === 'Escape') return 'Escape already cancels a recording'
  if (parts.length === 1 && !isStandalone(parts[0])) {
    return 'Add a modifier — a shortcut without one takes that key from every other app'
  }
  return 'Not a shortcut this app can register'
}
