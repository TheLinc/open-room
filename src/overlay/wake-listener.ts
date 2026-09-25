import { Segmenter } from '@shared/segmenter'
import { Capture } from './capture'

/**
 * Always-on listening, cut into segments.
 *
 * The microphone stays open for as long as wake words are enabled, and this
 * decides which slices of it are worth sending anywhere. Almost all of them
 * are not: a quiet room produces a `discard` every few seconds and nothing
 * ever leaves the renderer.
 *
 * Everything expensive is downstream. This runs on the AnalyserNode the
 * overlay already polls, so the cost of listening all day is one RMS per
 * animation frame.
 */
export class WakeListener {
  private readonly capture = new Capture()
  private segmenter: Segmenter | null = null
  private startedAt = 0
  private frame = 0

  /** Suppressed while the app is speaking, so it cannot hear itself. */
  private muted = false

  constructor(
    private readonly onSegment: (samples: Float32Array) => void,
    private readonly onError: (message: string) => void
  ) {}

  get isListening(): boolean {
    return this.segmenter !== null
  }

  async start(): Promise<void> {
    if (this.segmenter) return

    try {
      await this.capture.start()
    } catch (error) {
      this.onError(
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Microphone access was denied'
          : 'Could not open the microphone'
      )
      return
    }

    this.segmenter = new Segmenter()
    this.startedAt = performance.now()
    this.frame = requestAnimationFrame(this.poll)
  }

  stop(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.segmenter = null
    this.capture.discard()
  }

  /**
   * Stops segments being produced without closing the microphone.
   *
   * The second self-trigger defence. Playback leaks into the microphone on
   * any machine without perfect echo cancellation, and an agent answering its
   * own voice is both a loop and a way for a spoken line to run a command.
   * Buffered audio is dropped on unmute so the tail of playback cannot arrive
   * as the front of the next segment.
   */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return
    this.muted = muted
    if (!muted) this.capture.discardBuffered(0)
  }

  private readonly poll = (): void => {
    this.frame = requestAnimationFrame(this.poll)

    const segmenter = this.segmenter
    if (!segmenter) return

    const verdict = segmenter.push(this.capture.level(), performance.now() - this.startedAt)

    // While muted the gate keeps running so the noise floor stays current,
    // but no transcript may leave this renderer. Speech here is not treated
    // as barge-in: echo cancellation only subtracts audio Chromium plays, and
    // the TTS player is a separate process, so the app's own voice through
    // speakers read as someone talking over it and cut lines off mid-sentence.
    if (this.muted) {
      if (verdict !== 'listening') this.capture.discardBuffered(0)
      return
    }

    if (verdict === 'discard') {
      this.capture.discardBuffered()
      return
    }

    if (verdict === 'segment') {
      void this.capture.flush().then((samples) => {
        if (samples.length > 0) this.onSegment(samples)
      })
    }
  }
}
