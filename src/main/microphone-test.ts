/**
 * The settings microphone test.
 *
 * The only path in the app that opens the microphone without voice input
 * being enabled, which is why it is bounded at both ends: the user presses a
 * button to start it, and it stops on its own if they wander off with the
 * dialog open.
 */

/**
 * How long the test runs before stopping itself.
 *
 * Long enough to say a sentence and watch the bar, short enough that a dialog
 * left open behind another window does not hold the microphone all day.
 */
export const MIC_TEST_TIMEOUT_MS = 20_000

export type MicrophoneTestDeps = {
  /** Ask the overlay to open a metering stream. */
  startMeter: () => void
  /** Ask it to close the stream. */
  stopMeter: () => void
  /** A level to draw, or null once the test is over. */
  onLevel: (rms: number | null) => void
  timeoutMs?: number
}

export class MicrophoneTest {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: MicrophoneTestDeps) {}

  /** The timer is the authority on whether a test is running. */
  get isRunning(): boolean {
    return this.timer !== null
  }

  set(testing: boolean): void {
    this.clear()

    if (!testing) {
      this.deps.stopMeter()
      this.deps.onLevel(null)
      return
    }

    this.timer = setTimeout(() => this.set(false), this.deps.timeoutMs ?? MIC_TEST_TIMEOUT_MS)
    this.deps.startMeter()
  }

  /**
   * One reading from the overlay.
   *
   * Dropped unless a test is running: the overlay's stream takes a moment to
   * close, and a bar still moving after "stop" says the microphone is open
   * when it is not.
   */
  level(rms: number): void {
    if (this.isRunning) this.deps.onLevel(rms)
  }

  dispose(): void {
    this.set(false)
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
