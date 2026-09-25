import { quietLevel } from './endpointer'

/**
 * Cutting an always-open microphone into segments worth listening to.
 *
 * This is the cheap first gate. It runs on the AnalyserNode the overlay
 * already polls, costs nothing, and exists so that Silero — and behind it
 * the speech model — only ever see audio that might be someone talking. Amplitude
 * cannot tell speech from a slammed door, and it is not trying to: rejecting
 * a silent room is the whole job, and Silero decides the rest.
 *
 * Distinct from `Endpointer`, which ends a capture the user deliberately
 * started. This one never stops listening; it only decides where one segment
 * ends and the next begins.
 */

export type SegmenterConfig = {
  /** How long to sample the room before arming. */
  floorSampleMs: number
  /**
   * Trailing window the noise floor is read from, all day long.
   *
   * The floor used to be the mean of the first 400 ms and then never moved,
   * but a microphone left open for hours hears the room change: a fan comes
   * on, a TV starts, automatic gain drifts. Too low a floor keeps a segment
   * open to `maxSegmentMs`, so a wake phrase lands mid-segment where the
   * matcher (anchored to the front) cannot see it; too high a one never
   * opens a segment for a normal voice. A low percentile of the last few
   * seconds follows the room both ways and still reads the gaps between
   * words rather than the words.
   */
  floorWindowMs: number
  /** Silence this long, after speech, closes a segment. */
  hangMs: number
  /** How far above the noise floor counts as speech. */
  speechMultiplier: number
  /** A segment is cut at this length even if someone is still talking. */
  maxSegmentMs: number
  /**
   * Silence this long with no speech discards the buffer.
   *
   * Without it an idle room accumulates audio forever and the worklet's cap
   * eventually truncates the front of a real utterance.
   */
  idleFlushMs: number
}

export const DEFAULT_SEGMENTER: SegmenterConfig = {
  floorSampleMs: 400,
  floorWindowMs: 6000,
  hangMs: 700,
  speechMultiplier: 3,
  maxSegmentMs: 15_000,
  idleFlushMs: 3000
}

/** A silent room would otherwise give a zero threshold every frame clears. */
const MIN_FLOOR = 0.005

export type SegmenterVerdict =
  /** Nothing to do. */
  | 'listening'
  /** Speech ended, or ran long — take the buffer and transcribe it. */
  | 'segment'
  /** No speech for a while — throw the buffer away, keeping the pre-roll. */
  | 'discard'

export class Segmenter {
  private recent: { at: number; rms: number }[] = []
  private armed = false
  private floor = 0
  private speaking = false
  private lastLoudMs = 0
  private segmentStartMs = 0
  private lastResetMs = 0

  constructor(private readonly config: SegmenterConfig = DEFAULT_SEGMENTER) {}

  /** True while someone is talking, so the overlay can show it. */
  get isSpeaking(): boolean {
    return this.speaking
  }

  /**
   * Feeds one frame's level. `elapsedMs` runs from when listening started and
   * never resets — segments are bounded relative to it, not to it.
   */
  push(rms: number, elapsedMs: number): SegmenterVerdict {
    this.recent.push({ at: elapsedMs, rms })
    while (this.recent[0].at < elapsedMs - this.config.floorWindowMs) this.recent.shift()

    // Sample the room before arming, so the first frames are judged against
    // something rather than against nothing.
    if (elapsedMs < this.config.floorSampleMs) return 'listening'

    this.floor = Math.max(quietLevel(this.recent.map((frame) => frame.rms)), MIN_FLOOR)
    if (!this.armed) {
      this.armed = true
      this.lastResetMs = elapsedMs
    }

    const loud = rms > this.floor * this.config.speechMultiplier

    if (loud) {
      this.lastLoudMs = elapsedMs
      if (!this.speaking) {
        this.speaking = true
        this.segmentStartMs = elapsedMs
      }
    }

    if (this.speaking) {
      const ended = elapsedMs - this.lastLoudMs >= this.config.hangMs
      const tooLong = elapsedMs - this.segmentStartMs >= this.config.maxSegmentMs

      if (ended || tooLong) {
        this.speaking = false
        this.lastResetMs = elapsedMs
        return 'segment'
      }
      return 'listening'
    }

    if (elapsedMs - this.lastResetMs >= this.config.idleFlushMs) {
      this.lastResetMs = elapsedMs
      return 'discard'
    }

    return 'listening'
  }
}
