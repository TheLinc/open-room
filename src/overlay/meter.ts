import { Capture } from './capture'

/**
 * The microphone level, for the settings meter.
 *
 * Exists so someone can answer "is this the device I am actually talking
 * into" before trusting it with a wake word. It opens its own stream rather
 * than borrowing the wake listener's, because the case that matters is the
 * one where nothing else has the microphone open — a user setting the app up
 * for the first time, with voice input still off.
 *
 * Deliberately the only thing in the app that opens the microphone without
 * voice input being enabled, and only ever while a button is held on in
 * settings. Main stops it on a timeout as well, so a forgotten dialog cannot
 * leave the microphone open.
 */

/**
 * How often a level crosses to main.
 *
 * The poll runs on animation frames because that is when a new analyser
 * reading exists, but sixty IPC messages a second to move one bar is waste.
 * Twenty is past the rate at which a meter reads as continuous.
 */
export const REPORT_INTERVAL_MS = 50

/** The part of `Capture` this needs, so tests do not need a microphone. */
export type CaptureLike = {
  start: () => Promise<void>
  level: () => number
  discard: () => void
}

/**
 * The collaborators, injected so the decisions above can be tested.
 *
 * Audio lives in a renderer and the frame clock is the browser's, so neither
 * is reachable from a test where it normally sits.
 */
export type MeterDeps = {
  createCapture: () => CaptureLike
  currentDeviceId: () => string
  now: () => number
  schedule: (callback: () => void) => number
  cancel: (handle: number) => void
}

const BROWSER_DEPS: MeterDeps = {
  createCapture: () => new Capture(),
  currentDeviceId: () => Capture.deviceId,
  now: () => performance.now(),
  schedule: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle)
}

export class Meter {
  private readonly deps: MeterDeps
  private capture: CaptureLike | null = null
  private frame = 0
  private lastReport = 0

  /**
   * The device this stream was opened on.
   *
   * Kept so a change of selection can be noticed: metering the old device
   * after the user picked a new one would confirm the wrong microphone, which
   * is worse than showing no meter at all.
   */
  private openedOn: string | null = null

  constructor(
    private readonly onLevel: (rms: number) => void,
    private readonly onError: (message: string) => void,
    deps: Partial<MeterDeps> = {}
  ) {
    this.deps = { ...BROWSER_DEPS, ...deps }
  }

  get isRunning(): boolean {
    return this.capture !== null
  }

  async start(): Promise<void> {
    if (this.capture) return

    const capture = this.deps.createCapture()
    try {
      await capture.start()
    } catch (error) {
      this.onError(
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Microphone access was denied'
          : 'Could not open the microphone'
      )
      return
    }

    this.capture = capture
    this.openedOn = this.deps.currentDeviceId()
    this.lastReport = 0
    this.frame = this.deps.schedule(this.poll)
  }

  stop(): void {
    this.deps.cancel(this.frame)
    this.frame = 0
    this.capture?.discard()
    this.capture = null
    this.openedOn = null
  }

  /**
   * One frame's work.
   *
   * Separate from the loop below so it can be driven directly: the loop is
   * `requestAnimationFrame`, which does not exist outside a browser.
   */
  tick(): void {
    const capture = this.capture
    if (!capture) return

    // Picking a different device mid-test has to move the stream with it, and
    // nothing may be reported from the stream being torn down.
    if (this.openedOn !== this.deps.currentDeviceId()) {
      void this.restart()
      return
    }

    const now = this.deps.now()
    if (now - this.lastReport < REPORT_INTERVAL_MS) return
    this.lastReport = now

    this.onLevel(capture.level())
  }

  private readonly poll = (): void => {
    this.frame = this.deps.schedule(this.poll)
    this.tick()
  }

  /** Reopens on the newly selected device. */
  private async restart(): Promise<void> {
    this.stop()
    await this.start()
  }
}
