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
