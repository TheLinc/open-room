import { rmsOf } from '@shared/endpointer'
import { resolveMicrophone } from '@shared/voice-input'
// Vite bundles the worklet as its own chunk and hands back its URL. A plain
// `new URL('./pcm-worklet.ts', import.meta.url)` would emit the TypeScript
// source as an asset and the browser would choke on it at `addModule`.
import pcmWorkletUrl from './pcm-worklet.ts?worker&url'

/**
 * Owns the microphone.
 *
 * Capture lives in this renderer rather than the voice sidecar because
 * `getUserMedia` is a Chromium API — capturing in the plain-Node sidecar would
 * mean a native audio binding for a problem the browser already solves, and
 * CLAUDE.md rules native modules out of everything but the sidecar anyway. The
 * AnalyserNode driving the waveform belongs here too, next to the stream it
 * analyses.
 *
 * The context is opened at 16 kHz so Chromium does the resampling: Whisper is
 * trained on 16 kHz mono, and the sidecar's protocol expects exactly that.
 */
export class Capture {
  /**
   * The device every capture opens, by label, shared by push-to-talk and
   * wake listening. Empty is the system default.
   *
   * Static because there is one microphone selection per machine, and the two
   * consumers must not disagree about which one it is. A label rather than a
   * `deviceId`: the id changes on every launch (see `resolveMicrophone`), so
   * it is looked up at the moment a stream is opened.
   */
  static microphone = ''

  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private analyser: AnalyserNode | null = null
  private frame = new Float32Array(1024)
  private pending: ((samples: Float32Array) => void) | null = null

  /** Opens the microphone and starts collecting. Rejects if it cannot. */
  async start(): Promise<void> {
    // Idempotent: a second trigger arriving before the first teardown should
    // not leave an orphaned stream holding the microphone open.
    this.teardown()

    this.stream = await this.openStream()

    const context = new AudioContext({ sampleRate: 16_000 })
    this.context = context
    await context.audioWorklet.addModule(pcmWorkletUrl)

    // `start` is async, so a discard can land mid-await. Bail rather than
    // wiring a graph onto a stream that has already been stopped.
    if (this.context !== context) return

    const source = context.createMediaStreamSource(this.stream)

    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 2048

    this.node = new AudioWorkletNode(context, 'pcm-collector')
    this.node.port.onmessage = (event: MessageEvent<Float32Array>): void => {
      const resolve = this.pending
      this.pending = null
      resolve?.(event.data)
    }

    source.connect(this.analyser)
    source.connect(this.node)
  }

  /**
   * Opens the chosen device, falling back to the default if it is gone.
   *
   * `exact` rather than `ideal`, which is counter-intuitive: Chromium treats
   * an `ideal` deviceId as a soft preference and quietly keeps using the
   * system default, so a selected microphone appears to be ignored. `exact`
   * genuinely selects — and throws `OverconstrainedError` when the device has
   * been unplugged, which is what the fallback is for. Degrade, never fail.
   */
  private async openStream(): Promise<MediaStream> {
    const shared: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }

    const deviceId = Capture.microphone
      ? resolveMicrophone(await navigator.mediaDevices.enumerateDevices(), Capture.microphone)
      : null

    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { ...shared, deviceId: { exact: deviceId } }
        })
      } catch (error) {
        // A denial is not a missing device, and must not be swallowed here —
        // the caller turns it into something the user can act on.
        if (error instanceof Error && error.name === 'NotAllowedError') throw error
      }
    }

    return navigator.mediaDevices.getUserMedia({ audio: shared })
  }

  /** Current input level, 0–1, for the waveform and the endpointer. */
  level(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.frame)
    return rmsOf(this.frame)
  }

  /** Flushes the collected samples and tears the graph down. */
  stop(): Promise<Float32Array> {
    return this.collect(true)
  }

  /**
   * Flushes without stopping, for always-on listening.
   *
   * The microphone stays open and the next segment starts accumulating
   * immediately — closing and reopening it between segments would drop the
   * beginning of whatever came next, and would flicker the OS microphone
   * indicator on and off all day.
   */
  flush(): Promise<Float32Array> {
    return this.collect(false)
  }

  /**
   * Throws away everything but a tail of pre-roll.
   *
   * Silence is discarded rather than transcribed, but not all of it: the
   * moment before someone starts talking contains the onset of the first
   * word, and cutting exactly at the threshold clips it.
   */
  discardBuffered(keepMs = 500): void {
    this.node?.port.postMessage({
      type: 'drop',
      keepSamples: Math.round((keepMs / 1000) * 16_000)
    })
  }

  private collect(teardown: boolean): Promise<Float32Array> {
    const node = this.node
    if (!node) return Promise.resolve(new Float32Array(0))

    return new Promise((resolve) => {
      this.pending = (samples) => {
        if (teardown) this.teardown()
        resolve(samples)
      }
      node.port.postMessage({ type: 'flush' })
    })
  }

  /** Ends the capture and throws the audio away. */
  discard(): void {
    this.teardown()
  }

  private teardown(): void {
    // Stopping the tracks is what turns the OS microphone indicator off.
    // Leaving them running would tell the user we are still listening.
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    if (this.node) this.node.port.onmessage = null
    void this.context?.close().catch(() => {})

    this.pending = null
    this.stream = null
    this.context = null
    this.node = null
    this.analyser = null
  }
}
