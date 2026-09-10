/**
 * Light and dark, and who decides.
 *
 * The setting is one of three words. Main hands it to Electron's
 * `nativeTheme.themeSource`, and from there Chromium answers every window's
 * `prefers-color-scheme` query, so the renderer and the overlay follow it
 * with no channel of their own (`followColorScheme`). What Chromium cannot
 * paint from CSS — the native caption buttons on Windows and the colour the
 * window shows before its first paint — main sets from `themeChrome`.
 */

export const THEME_SETTINGS = ['system', 'light', 'dark'] as const
export type ThemeSetting = (typeof THEME_SETTINGS)[number]
export type Theme = 'light' | 'dark'

/** The theme a setting means on an OS that is, or is not, in dark mode. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): Theme {
  if (setting === 'system') return systemDark ? 'dark' : 'light'
  return setting
}

/**
 * Hex twins of the palette's `--background` and `--foreground`, for the
 * parts of the window CSS cannot reach. They have to match `main.css` or the
 * native buttons sit on a strip of a different colour.
 */
export function themeChrome(theme: Theme): { background: string; symbol: string } {
  return theme === 'dark'
    ? { background: '#0a0a0a', symbol: '#fafafa' }
    : { background: '#ffffff', symbol: '#0a0a0a' }
}
