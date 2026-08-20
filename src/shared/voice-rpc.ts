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
  | { id: number; method: 'vadStatus' }
  | { id: number; method: 'loadVad' }
  | {
      id: number
      method: 'listen'
      params: { pcm: string }
    }
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
  /** Ready in this process right now. False after every sidecar restart. */
  loaded: boolean
  /**
   * Weights are on disk. Survives restarts, so this — not `loaded` — is what
   * decides whether to offer a 163 MB download.
   */
  installed: boolean
  /** 0–1 while the weights are downloading. */
  progress?: number
  error?: string
}

/**
 * The result of one always-on listening segment.
 *
 * VAD and transcription happen in a single call so a rejected segment never
 * crosses a process boundary twice. Most segments are rejected — that is the
 * point of the gate — and the audio is already here.
 */
export type ListenResult = {
  /** Whether Silero thought this was speech at all. */
  speech: boolean
  /** Present only when it was; the empty string when Whisper heard nothing. */
  text?: string
}

/** Whether a downloadable model is present and usable. */
export type VadStatus = {
  loaded: boolean
  installed: boolean
  progress?: number
  error?: string
}

/** Whether the speech-to-text model is present and usable. */
export type SttStatus = {
  /** In memory and ready to transcribe. */
  loaded: boolean
  /**
   * On disk and checksum-verified, whether or not it is loaded.
   *
   * Separate from `loaded` because the gate on voice input is installation —
   * loading takes under a second, downloading takes minutes.
   */
  installed: boolean
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
