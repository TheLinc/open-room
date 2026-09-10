import { describe, expect, it } from 'vitest'
import { resolveTheme, themeChrome } from './theme'
import { appSettingsSchema, DEFAULT_SETTINGS } from './settings'

describe('resolveTheme', () => {
  it('follows the OS when the setting is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('ignores the OS when a theme is chosen', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('themeChrome', () => {
  it('matches the page background so the native buttons sit on the strip', () => {
    // oklch(0.145 0 0) and oklch(1 0 0), the two `--background` values.
    expect(themeChrome('dark')).toEqual({ background: '#0a0a0a', symbol: '#fafafa' })
    expect(themeChrome('light')).toEqual({ background: '#ffffff', symbol: '#0a0a0a' })
  })
})

describe('the theme setting', () => {
  it('defaults to dark, which is what every existing install shows', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark')
  })

  it('accepts the three values and nothing else', () => {
    expect(appSettingsSchema.parse({ theme: 'system' }).theme).toBe('system')
    expect(appSettingsSchema.parse({ theme: 'light' }).theme).toBe('light')
    expect(() => appSettingsSchema.parse({ theme: 'blue' })).toThrow()
  })
})
