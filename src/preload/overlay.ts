import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/ipc'
import type { OverlayEvent, OverlayState } from '@shared/voice-input'

/**
 * The overlay's bridge, deliberately far smaller than the main renderer's.
 *
 * The overlay displays state, owns the microphone, and reports what it
 * observes. It has no reason to reach agents, conversations, settings or the
 * supervisor — so it cannot. A window that is always on top and holds an open
 * microphone is the last place to hand a general-purpose channel into main.
 */

/** Subscribes to a main → overlay signal that carries no payload. */
function onSignal(channel: string, listener: () => void): () => void {
  const handler = (): void => listener()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

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
  },

  /** Open the microphone. */
  onStartCapture: (listener: () => void): (() => void) =>
    onSignal(IpcChannel.overlayStartCapture, listener),

  /** Flush what has been collected and send it back. */
  onStopCapture: (listener: () => void): (() => void) =>
    onSignal(IpcChannel.overlayStopCapture, listener),

  /** Close the microphone and throw the audio away. */
  onDiscardCapture: (listener: () => void): (() => void) =>
    onSignal(IpcChannel.overlayDiscardCapture, listener),

  /** The finished capture, base64 PCM. */
  reportAudio: (pcm: string): void => {
    ipcRenderer.send(IpcChannel.overlayAudio, pcm)
  },

  /** What the endpointer observed, or a failure to open the microphone. */
  reportEvent: (event: OverlayEvent): void => {
    ipcRenderer.send(IpcChannel.overlayEvent, event)
  }
}

contextBridge.exposeInMainWorld('overlay', overlay)

export type OverlayApi = typeof overlay
