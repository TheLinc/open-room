/**
 * The protocol between Electron main and the voice sidecar.
 *
 * Line-delimited JSON over stdio. Deliberately tiny: the sidecar exists to
 * keep native audio and, later, ONNX models out of the Electron process, so
 * the seam between them should be boring and easy to reason about.
 */

export type VoiceRequest =
  | { id: number; method: 'listVoices' }
  | {
      id: number
      method: 'speak'
      params: { text: string; voiceId?: string; rate: number; provider?: 'system' | 'kokoro' }
    }
  | { id: number; method: 'stop' }
  | { id: number; method: 'ping' }
  | { id: number; method: 'kokoroStatus' }
  | { id: number; method: 'loadKokoro' }
  | { id: number; method: 'sttStatus' }
  | { id: number; method: 'loadStt' }
  | {
      id: number
      method: 'transcribe'
      /** Base64 of a Float32Array of 16 kHz mono samples. */
      params: { pcm: string }
    }

export type VoiceResponse =
  { id: number; ok: true; result?: unknown } | { id: number; ok: false; error: string }

/** Whether the neural model is present and usable. */
export type KokoroStatus = {
  loaded: boolean
  /** 0–1 while the weights are downloading. */
  progress?: number
  error?: string
}

/** Whether the speech-to-text model is present and usable. */
export type SttStatus = {
  loaded: boolean
  /** 0–1 while the weights are downloading. */
  progress?: number
  error?: string
}

export type SystemVoice = {
  id: string
  label: string
  /** BCP-47-ish tag as the platform reports it; may be absent. */
  locale?: string
}

/**
 * Why a `speak` call ended.
 *
 * `stopped` is a normal outcome, not a failure — preemption and barge-in both
 * end playback early by design.
 */
export type SpeakOutcome = 'completed' | 'stopped'

export function encodeMessage(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

/**
 * Splits a stdio chunk into whole JSON lines, returning any trailing partial
 * line for the next chunk. Stream reads do not respect message boundaries.
 */
export function decodeMessages(buffer: string): { messages: unknown[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const messages: unknown[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      messages.push(JSON.parse(trimmed))
    } catch {
      // A malformed line is not worth killing the channel over; the sidecar
      // also writes diagnostics to stderr, which is where noise belongs.
    }
  }

  return { messages, rest }
}
