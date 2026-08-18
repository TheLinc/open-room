import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IpcChannel } from '@shared/ipc'
import { HIDDEN_OVERLAY, type OverlayState } from '@shared/voice-input'

/**
 * The listening overlay and working HUD.
 *
 * Created once at launch and shown or hidden thereafter. Creating a window
 * costs a few hundred milliseconds, and an indicator that appears a beat after
 * you start talking is worse than no indicator at all.
 *
 * Its bounds never change. Window resizing cannot be animated smoothly on
 * Windows, so the window is sized once for the widest state it will ever show
 * — the expanded roster, the hovered two-line transcript — and everything
 * animates inside it.
 */

const WIDTH = 460
const HEIGHT = 220

/** Clear of the Windows taskbar and the macOS Dock. */
const BOTTOM_MARGIN = 64

export class OverlayWindow {
  private window: BrowserWindow | null = null

  /**
   * The most recent state, replayed once the renderer is ready.
   *
   * `webContents.send` before the document has finished loading is dropped
   * silently, so a state arriving during startup — or during the rebuild
   * after a render-process-gone — would leave a window on screen painting
   * nothing at all.
   */
  private lastState: OverlayState = HIDDEN_OVERLAY

  /**
   * Whether the document has finished loading.
   *
   * `webContents.send` before that point is dropped silently. State survives
   * it via `lastState`, but a capture signal has no such backstop — losing one
   * would leave the pill on screen with the microphone closed.
   */
  private loaded = false
  private queued: string[] = []

  create(): void {
    // Deliberately the primary display rather than whichever screen holds the
    // cursor: the overlay should appear in one predictable place.
    const { workArea } = screen.getPrimaryDisplay()

    this.window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: Math.round(workArea.y + workArea.height - HEIGHT - BOTTOM_MARGIN),
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      // Clicks land but keyboard focus never moves here: clicking a pip must
      // focus the main window, not this one.
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // 'screen-saver' is the level that stays above full-screen windows, which
    // is where a global push-to-talk indicator has to live.
    this.window.setAlwaysOnTop(true, 'screen-saver')
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // forward: true keeps mouse-move flowing to the renderer, which is what
    // makes hover work on a window that clicks pass through.
    this.window.setIgnoreMouseEvents(true, { forward: true })

    this.window.webContents.on('did-finish-load', () => {
      this.loaded = true
      this.window?.webContents.send(IpcChannel.overlayState, this.lastState)
      for (const channel of this.queued.splice(0)) {
        this.window?.webContents.send(channel)
      }
    })

    // A dead overlay means voice input silently stops working, with no window
    // left to say so. Rebuild it rather than losing the feature.
    this.window.webContents.on('render-process-gone', () => {
      this.loaded = false
      this.window?.destroy()
      this.window = null
      this.create()
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
    } else {
      this.window.loadFile(join(__dirname, '../renderer/overlay.html'))
    }
  }

  send(state: OverlayState): void {
    this.lastState = state
    if (!this.window || this.window.isDestroyed()) return

    this.window.webContents.send(IpcChannel.overlayState, state)

    if (state.phase === 'hidden') {
      this.window.hide()
    } else if (!this.window.isVisible()) {
      // showInactive rather than show: raising the overlay must never steal
      // focus from whatever the user is actually working in.
      this.window.showInactive()
    }
  }

  /** Open the microphone. */
  startCapture(): void {
    this.signal(IpcChannel.overlayStartCapture)
  }

  /** Flush what has been collected; the audio comes back on `overlayAudio`. */
  stopCapture(): void {
    this.signal(IpcChannel.overlayStopCapture)
  }

  /** Close the microphone and throw the audio away. */
  discardCapture(): void {
    this.signal(IpcChannel.overlayDiscardCapture)
  }

  private signal(channel: string): void {
    if (!this.window || this.window.isDestroyed()) return
    if (this.loaded) this.window.webContents.send(channel)
    else this.queued.push(channel)
  }

  /**
   * Whether some webContents is this overlay's.
   *
   * The microphone permission is granted to this window and nothing else, and
   * the window is rebuilt after a render-process crash — so identity has to be
   * asked for rather than captured once.
   */
  owns(contents: { id: number }): boolean {
    if (!this.window || this.window.isDestroyed()) return false
    return this.window.webContents.id === contents.id
  }

  /** Accepts clicks while the pointer is over the bubble; passes them through otherwise. */
  setInteractive(interactive: boolean): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setIgnoreMouseEvents(!interactive, { forward: true })
  }

  hide(): void {
    this.lastState = HIDDEN_OVERLAY
    if (this.window && !this.window.isDestroyed()) this.window.hide()
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}
