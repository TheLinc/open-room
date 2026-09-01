import { describe, expect, it, vi } from 'vitest'

/**
 * The overlay window's construction options.
 *
 * Ordinarily window plumbing is not worth a test, but two of these are
 * load-bearing in a way that fails silently, with nothing on screen and
 * nothing in a log to say why.
 */

const created: Electron.BrowserWindowConstructorOptions[] = []
const windows: FakeWindow[] = []
const screenListeners = new Map<string, () => void>()
let workArea = { x: 0, y: 0, width: 1920, height: 1080 }

type FakeWindow = {
  setBounds: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  visible: boolean
}

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents = { on: vi.fn(), send: vi.fn(), id: 1 }
    visible = false
    bounds: Electron.Rectangle
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      created.push(options)
      windows.push(this)
      this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: 460, height: 220 }
    }
    getBounds = (): Electron.Rectangle => this.bounds
    setBounds = vi.fn((bounds: Electron.Rectangle) => {
      this.bounds = { ...this.bounds, ...bounds }
    })
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isDestroyed = (): boolean => false
    isVisible = (): boolean => this.visible
    showInactive = vi.fn(() => {
      this.visible = true
    })
    hide = vi.fn(() => {
      this.visible = false
    })
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({ workArea }),
      getCursorScreenPoint: () => ({ x: -1, y: -1 }),
      on: (event: string, listener: () => void) => {
        screenListeners.set(event, listener)
      }
    }
  }
})

// Mocked as well as `electron`: this reaches into the real electron module
// from inside node_modules, where the mock above does not reach.
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { OverlayWindow } = await import('./overlay-window')
const { HIDDEN_OVERLAY } = await import('@shared/voice-input')

function optionsOfNewOverlay(): Electron.BrowserWindowConstructorOptions {
  created.length = 0
  new OverlayWindow().create()
  return created[0]
}

function newOverlay(): { overlay: InstanceType<typeof OverlayWindow>; window: FakeWindow } {
  windows.length = 0
  workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const overlay = new OverlayWindow()
  overlay.create()
  return { overlay, window: windows[0] }
}

const LISTENING = { ...HIDDEN_OVERLAY, phase: 'listening' as const }

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

describe('overlay window placement', () => {
  // Placement used to be computed once, in the constructor, from whichever
  // display was primary at launch. Field report: the pill turned up on the
  // wrong monitor. A display change after launch � a monitor sleeping, a dock,
  // a re-ordered arrangement � moves the window and nothing moved it back.
  // The window is hidden almost all the time, so the moment that matters is
  // the show.

  it('re-places itself on the current primary display each time it is shown', () => {
    const { overlay, window } = newOverlay()

    workArea = { x: -1920, y: 0, width: 1920, height: 1040 }
    overlay.send(LISTENING)

    expect(window.showInactive).toHaveBeenCalled()
    expect(window.setBounds).toHaveBeenCalledWith({
      x: -1920 + Math.round((1920 - 460) / 2),
      y: 1040 - 220 - 64
    })
  })

  it('does not touch the bounds when nothing has changed', () => {
    const { overlay, window } = newOverlay()

    overlay.send(LISTENING)

    expect(window.setBounds).not.toHaveBeenCalled()
  })

  it('follows the primary display while visible', () => {
    const { overlay, window } = newOverlay()
    overlay.send(LISTENING)

    workArea = { x: 0, y: 0, width: 2560, height: 1400 }
    screenListeners.get('display-metrics-changed')?.()

    expect(window.setBounds).toHaveBeenCalledWith({
      x: Math.round((2560 - 460) / 2),
      y: 1400 - 220 - 64
    })
  })
})
