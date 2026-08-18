import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/ipc'
import type { OverlayState } from '@shared/voice-input'

/**
 * The overlay's bridge, deliberately far smaller than the main renderer's.
 *
 * The overlay displays state and reports what it observes. It has no reason to
 * reach agents, conversations, settings or the supervisor — so it cannot. A
 * window that is always on top and owns the microphone is the last place to
 * hand a general-purpose channel into main.
 */
const overlay = {
  /** Subscribes to overlay state. Returns an unsubscribe function. */
  onState: (listener: (state: OverlayState) => void): (() => void) => {
    const handler = (_event: unknown, state: OverlayState): void => listener(state)
    ipcRenderer.on(IpcChannel.overlayState, handler)
    return () => ipcRenderer.removeListener(IpcChannel.overlayState, handler)
  },

  /**
   * Asks main to accept clicks while the pointer is over the bubble.
   *
   * The window is click-through by default with mouse-move forwarded, which is
   * what lets hover work at all; this is how the HUD becomes clickable without
   * the voice states ever being clickable.
   */
  setInteractive: (interactive: boolean): void => {
    ipcRenderer.send(IpcChannel.overlaySetInteractive, interactive)
  }
}

contextBridge.exposeInMainWorld('overlay', overlay)

export type OverlayApi = typeof overlay
