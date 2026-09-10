import { describe, expect, it, vi } from 'vitest'
import { followColorScheme } from './theme'

/** The two DOM objects the helper touches, without a DOM. */
function fakes(dark: boolean) {
  const classes = new Set<string>()
  const root = {
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name)
        else classes.delete(name)
        return force
      }
    }
  }
  let listener: ((event: { matches: boolean }) => void) | null = null
  const media = {
    matches: dark,
    addEventListener: vi.fn((_: 'change', fn: (event: { matches: boolean }) => void) => {
      listener = fn
    }),
    removeEventListener: vi.fn()
  }
  return { root, media, classes, flip: (matches: boolean) => listener?.({ matches }) }
}

describe('followColorScheme', () => {
  it('sets the dark class from the query before anything renders', () => {
    const { root, media, classes } = fakes(true)
    followColorScheme(root, media)
    expect(classes.has('dark')).toBe(true)
  })

  it('clears it for a light scheme', () => {
    const { root, media, classes } = fakes(false)
    followColorScheme(root, media)
    expect(classes.has('dark')).toBe(false)
  })

  it('tracks changes, which is how a settings change or an OS switch arrives', () => {
    // Main sets nativeTheme.themeSource; Chromium answers through this query.
    const { root, media, classes, flip } = fakes(false)
    followColorScheme(root, media)
    flip(true)
    expect(classes.has('dark')).toBe(true)
    flip(false)
    expect(classes.has('dark')).toBe(false)
  })
})
