/**
 * Keeps the `dark` class on the root element in step with the colour scheme
 * Chromium reports.
 *
 * Main sets `nativeTheme.themeSource` from the theme setting, and Chromium
 * answers `prefers-color-scheme` in every window from that — so this is the
 * whole of the renderer's theme plumbing, with no IPC. It runs before React
 * mounts so the first paint is already the right theme; the window is shown
 * on `ready-to-show` anyway, so nothing earlier is ever seen.
 *
 * The two arguments are the DOM objects it touches, passed in so the
 * decision can be tested without a document.
 */
type Root = { classList: { toggle: (name: string, force: boolean) => boolean } }
type SchemeQuery = {
  matches: boolean
  addEventListener: (type: 'change', listener: (event: { matches: boolean }) => void) => void
}

export function followColorScheme(root: Root, query: SchemeQuery): void {
  root.classList.toggle('dark', query.matches)
  query.addEventListener('change', (event) => root.classList.toggle('dark', event.matches))
}

/** The real thing, for the entry points. */
export function followSystemColorScheme(): void {
  followColorScheme(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'))
}
