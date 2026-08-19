import { describe, expect, it, vi } from 'vitest'

/**
 * The overlay window's construction options.
 *
 * Ordinarily window plumbing is not worth a test, but two of these are
 * load-bearing in a way that fails silently, with nothing on screen and
 * nothing in a log to say why.
 */

const created: Electron.BrowserWindowConstructorOptions[] = []

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents = { on: vi.fn(), send: vi.fn(), id: 1 }
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      created.push(options)
    }
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isDestroyed = (): boolean => false
    isVisible = (): boolean => false
    showInactive = vi.fn()
    hide = vi.fn()
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
  }
})

// Mocked as well as `electron`: this reaches into the real electron module
// from inside node_modules, where the mock above does not reach.
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { OverlayWindow } = await import('./overlay-window')

function optionsOfNewOverlay(): Electron.BrowserWindowConstructorOptions {
  created.length = 0
  new OverlayWindow().create()
  return created[0]
}

describe('overlay window options', () => {
  it('keeps its render clock running while hidden', () => {
    // The whole of always-on wake listening rests on this. The overlay is
    // hidden whenever there is no pill and no pip, and Chromium stops
    // requestAnimationFrame outright for a hidden window — measured as 0
    // frames per 2 seconds against 331 when this is false. Without it the
    // listener starts, polls until the first hide, and is silently dead for
    // the rest of the session, reporting itself started the whole time.
    expect(optionsOfNewOverlay().webPreferences?.backgroundThrottling).toBe(false)
  })

  it('never takes keyboard focus', () => {
    // Clicking a pip must raise the main window, not this one.
    expect(optionsOfNewOverlay().focusable).toBe(false)
  })

  it('stays out of the taskbar and above other windows', () => {
    const options = optionsOfNewOverlay()
    expect(options.alwaysOnTop).toBe(true)
    expect(options.skipTaskbar).toBe(true)
  })

  it('gives the renderer no Node access', () => {
    const options = optionsOfNewOverlay()
    expect(options.webPreferences?.contextIsolation).toBe(true)
    expect(options.webPreferences?.nodeIntegration).toBe(false)
  })
})
