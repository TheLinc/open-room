import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/ipc'
import type { OverlayEvent, OverlayHitBox, OverlayState, PipEntry } from '@shared/voice-input'

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
   * Reports where the interactive content is and whether it takes clicks.
   *
   * This window receives no mouse messages of its own, so main hit-tests the
   * real cursor against this box and answers on `onPointer`. It is also what
   * decides when clicks stop passing through.
   */
  reportHitBox: (box: OverlayHitBox): void => {
    ipcRenderer.send(IpcChannel.overlayHitBox, box)
  },

  /** Whether the cursor is inside the reported box. The overlay's only hover. */
  onPointer: (listener: (inside: boolean) => void): (() => void) => {
    const handler = (_event: unknown, inside: boolean): void => listener(inside)
    ipcRenderer.on(IpcChannel.overlayPointer, handler)
    return () => ipcRenderer.removeListener(IpcChannel.overlayPointer, handler)
  },

  /** Subscribes to the working HUD. Returns an unsubscribe function. */
  onPips: (listener: (pips: PipEntry[]) => void): (() => void) => {
    const handler = (_event: unknown, pips: PipEntry[]): void => listener(pips)
    ipcRenderer.on(IpcChannel.overlayPips, handler)
    return () => ipcRenderer.removeListener(IpcChannel.overlayPips, handler)
  },

  /** Raises the main window on this agent. */
  selectAgent: (agentId: string): void => {
    ipcRenderer.send(IpcChannel.overlaySelectAgent, agentId)
  },

  /** Pointer entered or left the bubble; pauses dismissal. */
  reportHover: (hovered: boolean): void => {
    ipcRenderer.send(IpcChannel.overlayHover, hovered)
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
