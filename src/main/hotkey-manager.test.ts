import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@shared/agent'
import { DEFAULT_SETTINGS } from '@shared/settings'

/**
 * Electron's globalShortcut is faked rather than mocked per-test.
 *
 * The behaviour that matters is what happens when another application
 * already holds a combination — `register` signals that by returning false
 * rather than throwing, which is exactly the kind of thing that gets
 * swallowed.
 */
const registered = new Map<string, () => void>()
let taken: string[] = []
let invalid: string[] = []

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, handler: () => void): boolean => {
      if (invalid.includes(accelerator)) throw new Error(`Invalid accelerator: ${accelerator}`)
      if (taken.includes(accelerator)) return false
      registered.set(accelerator, handler)
      return true
    },
    unregister: (accelerator: string): void => {
      registered.delete(accelerator)
    },
    unregisterAll: (): void => {
      registered.clear()
    },
    isRegistered: (accelerator: string): boolean => registered.has(accelerator)
  }
}))

const { HotkeyManager, bindingsFor } = await import('./hotkey-manager')

function agent(id: string, hotkey?: string): Agent {
  return { config: { id, name: id, hotkey }, context: '' } as unknown as Agent
}

const enabled = { ...DEFAULT_SETTINGS, voiceInputEnabled: true }

beforeEach(() => {
  registered.clear()
  taken = []
  invalid = []
})

describe('bindingsFor', () => {
  it('is empty when voice input is off', () => {
    const off = { ...DEFAULT_SETTINGS, voiceInputEnabled: false }

    expect(bindingsFor(off, [agent('atlas', 'Alt+A')])).toEqual([])
  })

  it('includes the global binding and every per-agent binding', () => {
    expect(bindingsFor(enabled, [agent('atlas', 'Alt+A'), agent('scout')])).toEqual([
      { accelerator: enabled.pushToTalkHotkey, agentId: null },
      { accelerator: 'Alt+A', agentId: 'atlas' }
    ])
  })

  it('ignores a hotkey that is only whitespace', () => {
    expect(bindingsFor(enabled, [agent('atlas', '   ')])).toHaveLength(1)
  })

  it('omits the global binding when it has been cleared', () => {
    const cleared = { ...enabled, pushToTalkHotkey: '' }

    expect(bindingsFor(cleared, [agent('atlas', 'Alt+A')])).toEqual([
      { accelerator: 'Alt+A', agentId: 'atlas' }
    ])
  })
})

describe('HotkeyManager', () => {
  it('registers each binding and reports no failures', () => {
    const manager = new HotkeyManager(vi.fn())

    expect(manager.apply([{ accelerator: 'Alt+A', agentId: 'atlas' }])).toEqual([])
    expect(registered.has('Alt+A')).toBe(true)
  })

  it('reports a conflict rather than swallowing it', () => {
    taken = ['Alt+A']
    const manager = new HotkeyManager(vi.fn())

    const failures = manager.apply([{ accelerator: 'Alt+A', agentId: 'atlas' }])

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ accelerator: 'Alt+A', agentId: 'atlas' })
    expect(failures[0].reason).toMatch(/another application/i)
  })

  it('reports an accelerator Electron itself cannot parse', () => {
    // Well-formed enough to pass our own check, so this covers the throw path
    // rather than the pre-check that now sits in front of it.
    invalid = ['Alt+NotAKey']
    const manager = new HotkeyManager(vi.fn())

    const failures = manager.apply([{ accelerator: 'Alt+NotAKey', agentId: null }])

    expect(failures).toHaveLength(1)
    expect(failures[0].reason).toMatch(/invalid accelerator/i)
  })

  it('registers the bindings that work even when one fails', () => {
    taken = ['Alt+A']
    const manager = new HotkeyManager(vi.fn())

    manager.apply([
      { accelerator: 'Alt+A', agentId: 'atlas' },
      { accelerator: 'Alt+B', agentId: 'scout' }
    ])

    expect(registered.has('Alt+B')).toBe(true)
  })

  it('invokes the trigger with the binding target', () => {
    const onTrigger = vi.fn()
    const manager = new HotkeyManager(onTrigger)
    manager.apply([{ accelerator: 'Alt+A', agentId: 'atlas' }])

    registered.get('Alt+A')?.()

    expect(onTrigger).toHaveBeenCalledWith('atlas')
  })

  it('passes null for the global binding, meaning the selected agent', () => {
    const onTrigger = vi.fn()
    const manager = new HotkeyManager(onTrigger)
    manager.apply([{ accelerator: 'Alt+G', agentId: null }])

    registered.get('Alt+G')?.()

    expect(onTrigger).toHaveBeenCalledWith(null)
  })

  it('refuses a bare letter rather than taking that key from every other app', () => {
    // Exactly what a plain text field used to produce: the modifiers type
    // nothing and only the letter is stored.
    const manager = new HotkeyManager(vi.fn())

    const failures = manager.apply([{ accelerator: 'a', agentId: 'derek' }])

    expect(failures).toHaveLength(1)
    expect(failures[0].reason).toMatch(/modifier/i)
    expect(registered.has('a')).toBe(false)
  })

  it('still registers the valid bindings alongside a refused one', () => {
    const manager = new HotkeyManager(vi.fn())

    manager.apply([
      { accelerator: 'a', agentId: 'derek' },
      { accelerator: 'Alt+B', agentId: 'scout' }
    ])

    expect(registered.has('Alt+B')).toBe(true)
  })

  it('releases bindings that are no longer wanted when re-applied', () => {
    const manager = new HotkeyManager(vi.fn())
    manager.apply([{ accelerator: 'Alt+A', agentId: 'atlas' }])

    manager.apply([{ accelerator: 'Alt+B', agentId: 'scout' }])

    expect(registered.has('Alt+A')).toBe(false)
    expect(registered.has('Alt+B')).toBe(true)
  })

  it('registers Escape only while a capture is running', () => {
    const manager = new HotkeyManager(vi.fn())
    const onEscape = vi.fn()

    manager.registerEscape(onEscape)
    expect(registered.has('Escape')).toBe(true)

    registered.get('Escape')?.()
    expect(onEscape).toHaveBeenCalled()

    manager.unregisterEscape()
    expect(registered.has('Escape')).toBe(false)
  })

  it('tolerates unregistering Escape that was never registered', () => {
    const manager = new HotkeyManager(vi.fn())

    expect(() => manager.unregisterEscape()).not.toThrow()
  })

  it('does not let Escape survive a rebind', () => {
    // Esc is global while it exists; leaking it would swallow the key for
    // every other application.
    const manager = new HotkeyManager(vi.fn())
    manager.registerEscape(vi.fn())

    manager.dispose()

    expect(registered.size).toBe(0)
  })
})
