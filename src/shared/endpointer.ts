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
  /**
   * A capture never runs longer than this, speech or not.
   *
   * This is a stuck-microphone failsafe, not a UX bound — at 30s it cut off
   * a real dictated prompt mid-sentence and dispatched the truncated text.
   * It stays unconditional because the runaway case it guards against (a TV
   * keeping the detector loud) is exactly the one that never goes quiet;
   * what changed is the magnitude. Five minutes of 16kHz mono is ~19MB.
   */
  maxDurationMs: number
  /** How far above the noise floor counts as speech. */
  speechMultiplier: number
  /**
   * Trailing window the floor may ratchet *down* from, never up. A floor
   * sampled while the user was already talking sits above their voice and
   * deafens the capture; the first between-sentences pause repairs it. Down
   * only, so a genuinely noisy room keeps its high floor.
   */
  floorAdaptMs: number
}

export const DEFAULT_ENDPOINTER: EndpointerConfig = {
  floorSampleMs: 300,
  hangMs: 2500,
  noSpeechTimeoutMs: 5000,
  maxDurationMs: 300_000,
  speechMultiplier: 3,
  floorAdaptMs: 1000
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

/**
 * A level most of the window sat at or below. The 25th percentile rather
 * than the mean: someone who presses the hotkey and starts talking inside
 * the floor window leaves a mean at speech level, which deafens the capture
 * to the very voice that set it — but the beat of quiet before their first
 * word is still in the samples, and a low percentile reads that instead.
 */
function quietLevel(samples: number[]): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(0.25 * (sorted.length - 1))]
}

export class Endpointer {
  private floorSamples: number[] = []
  private floor = 0
  private recent: { rms: number; at: number }[] = []
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

    // Sample the room first. Speech during this window is repaired by the
    // percentile and, failing that, by the downward ratchet below.
    if (elapsedMs < this.config.floorSampleMs) {
      this.floorSamples.push(rms)
      return 'listening'
    }

    if (this.floor === 0) {
      this.floor = Math.max(quietLevel(this.floorSamples), MIN_FLOOR)
    }

    // The floor only ever ratchets down: a trailing window quieter than the
    // floor proves the floor was set during speech, while a noisy room keeps
    // producing loud frames and holds its floor. Without this, talking
    // through the whole floor window left a capture deaf until it cancelled.
    this.recent.push({ rms, at: elapsedMs })
    while (this.recent.length > 0 && this.recent[0].at < elapsedMs - this.config.floorAdaptMs) {
      this.recent.shift()
    }
    const trailing = Math.max(quietLevel(this.recent.map((entry) => entry.rms)), MIN_FLOOR)
    if (trailing < this.floor) this.floor = trailing

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
