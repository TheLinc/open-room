/**
 * Decides when someone has stopped talking.
 *
 * This is not VAD in the Phase 5b sense — it never decides whether to start
 * listening, only when an already-running capture should stop. That lets it be
 * an RMS threshold over the AnalyserNode the waveform already needs, rather
 * than a second ONNX model and an always-open microphone.
 *
 * The threshold is relative to a noise floor sampled at the start, because a
 * fixed one is wrong in both directions: too sensitive in a server room, deaf
 * in a quiet one.
 */

export type EndpointerConfig = {
  /** How long to sample the room before arming anything. */
  floorSampleMs: number
  /** Silence this long, after speech, ends the capture. */
  hangMs: number
  /** No speech at all within this window cancels the capture. */
  noSpeechTimeoutMs: number
  /** A capture never runs longer than this, speech or not. */
  maxDurationMs: number
  /** How far above the noise floor counts as speech. */
  speechMultiplier: number
}

export const DEFAULT_ENDPOINTER: EndpointerConfig = {
  floorSampleMs: 300,
  hangMs: 1500,
  noSpeechTimeoutMs: 5000,
  maxDurationMs: 30_000,
  speechMultiplier: 3
}

/**
 * A silent room would otherwise give a zero threshold that every frame clears,
 * making the first breath read as speech.
 */
const MIN_FLOOR = 0.005

export type EndpointerVerdict =
  'listening' | 'speech-started' | 'ended-silence' | 'ended-max-duration' | 'cancelled-no-speech'

export function rmsOf(frame: Float32Array): number {
  if (frame.length === 0) return 0

  let sum = 0
  for (const sample of frame) sum += sample * sample
  return Math.sqrt(sum / frame.length)
}

export class Endpointer {
  private floorSamples: number[] = []
  private floor = 0
  private speechStarted = false
  private lastLoudMs = 0
  private done = false

  constructor(private readonly config: EndpointerConfig = DEFAULT_ENDPOINTER) {}

  /**
   * Feeds one frame's level. `elapsedMs` is measured from capture start.
   *
   * Returns a terminal verdict at most once; every call afterwards reports
   * `listening`, so a caller that keeps pushing cannot double-fire.
   */
  push(rms: number, elapsedMs: number): EndpointerVerdict {
    if (this.done) return 'listening'

    if (elapsedMs >= this.config.maxDurationMs) {
      this.done = true
      return 'ended-max-duration'
    }

    // Sample the room first. Speech during this window raises the floor and
    // makes the detector less sensitive, which is the safe direction to err.
    if (elapsedMs < this.config.floorSampleMs) {
      this.floorSamples.push(rms)
      return 'listening'
    }

    if (this.floor === 0) {
      const mean =
        this.floorSamples.reduce((sum, value) => sum + value, 0) /
        Math.max(1, this.floorSamples.length)
      this.floor = Math.max(mean, MIN_FLOOR)
    }

    if (rms > this.floor * this.config.speechMultiplier) {
      this.lastLoudMs = elapsedMs
      if (!this.speechStarted) {
        this.speechStarted = true
        return 'speech-started'
      }
      return 'listening'
    }

    // Silence only ends a capture that has heard something. Otherwise it is
    // the pause between pressing the key and starting to talk.
    if (!this.speechStarted) {
      if (elapsedMs >= this.config.noSpeechTimeoutMs) {
        this.done = true
        return 'cancelled-no-speech'
      }
      return 'listening'
    }

    if (elapsedMs - this.lastLoudMs >= this.config.hangMs) {
      this.done = true
      return 'ended-silence'
    }

    return 'listening'
  }
}
