/**
 * What the overlay is showing, shared between main and both renderers.
 *
 * Main owns this. The overlay renders it and reports what it observes; it
 * never decides its own phase.
 */

export type OverlayPhase =
  'hidden' | 'listening' | 'transcribing' | 'dispatched' | 'speaking' | 'error'

export type OverlayState = {
  phase: OverlayPhase
  agentId: string | null
  agentName: string
  /** Identity colour as hex. Answers "which agent", never "what state". */
  agentColor: string
  conversationTitle: string
  /** Shown in the `dispatched` phase: one line, hover expands it. */
  transcript: string
  /** Shown in the `error` phase. */
  message: string
}

export const HIDDEN_OVERLAY: OverlayState = {
  phase: 'hidden',
  agentId: null,
  agentName: '',
  agentColor: '',
  conversationTitle: '',
  transcript: '',
  message: ''
}

/** One entry in the working-agent HUD. */
export type PipEntry = {
  agentId: string
  name: string
  /** Identity colour as hex. */
  color: string
  state: 'working' | 'needs-attention'
}

const HOLD_BASE_MS = 1400
const HOLD_PER_WORD_MS = 40
const HOLD_MAX_MS = 4000

/**
 * How long the dispatched bubble stays up.
 *
 * Scales with length so a long utterance is readable and there is time to
 * reach it with the pointer, capped so nothing becomes furniture.
 */
export function holdMsFor(transcript: string): number {
  const trimmed = transcript.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  return Math.min(HOLD_BASE_MS + words * HOLD_PER_WORD_MS, HOLD_MAX_MS)
}

/**
 * What the overlay reports upward during a capture.
 *
 * A strict subset of the capture reducer's events: the overlay says what it
 * observed and main decides what that means. Deliberately not the whole
 * `CaptureEvent` union — nothing in the overlay may trigger a capture,
 * dispatch a prompt, or declare a transcript.
 */
export type OverlayEvent =
  | { type: 'speechStarted' }
  | { type: 'silence' }
  | { type: 'noSpeech' }
  | { type: 'maxDuration' }
  | { type: 'failed'; message: string }

const OBSERVED = ['speechStarted', 'silence', 'noSpeech', 'maxDuration', 'failed'] as const

/**
 * Validates an event arriving over IPC.
 *
 * `ipcRenderer.send` payloads are whatever the sending document chose to put
 * there. This one comes from a window that holds the microphone and sits above
 * every other application, so main checks the shape rather than trusting it.
 */
export function isOverlayEvent(value: unknown): value is OverlayEvent {
  if (typeof value !== 'object' || value === null) return false

  const event = value as { type?: unknown; message?: unknown }
  if (!OBSERVED.includes(event.type as (typeof OBSERVED)[number])) return false

  return event.type !== 'failed' || typeof event.message === 'string'
}

/**
 * The overlay's interactive region, in window-relative CSS pixels.
 *
 * Main hit-tests the real cursor against this rather than relying on the
 * document's own pointer events. A click-through, non-focusable, always-on-top
 * window receives no mouse messages on Windows — `setIgnoreMouseEvents(true,
 * { forward: true })` does not deliver them here — so `:hover`, `mouseenter`
 * and `mouseleave` never fire inside it. Every hover affordance in the overlay
 * depends on this instead.
 */
export type OverlayHitBox = {
  x: number
  y: number
  width: number
  height: number
  /**
   * Whether clicks should land on it.
   *
   * True only for the HUD. A transient voice bubble you can click by accident
   * while reaching for what is underneath is a bug, so the pill reports its
   * box for hover and stays click-through.
   */
  interactive: boolean
}

export const EMPTY_HIT_BOX: OverlayHitBox = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  interactive: false
}

/**
 * An input device the overlay can see.
 *
 * Enumerated in the overlay rather than the main window because only the
 * overlay holds microphone permission, and Chromium withholds device labels
 * from a page that does not.
 */
export type MicrophoneDevice = {
  deviceId: string
  label: string
}
