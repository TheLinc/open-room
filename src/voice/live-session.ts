import { LiveTranscript, cutPoint, words } from './live-transcript'

/**
 * One capture's audio as it arrives, decoded as it grows.
 *
 * Chunks are appended as the overlay sends them. A decode runs whenever at
 * least `MIN_NEW_S` of audio has arrived since the last one started and no
 * decode is in flight, so a slow machine simply gets fewer partials rather
 * than a queue of stale ones. Each decode covers the open window, from the
 * last cut to the newest sample; `LiveTranscript` turns its words into the
 * committed and tentative text the pill shows. When the window passes its
 * limit, the audio before the quietest gap is decoded once more and sealed.
 *
 * `finish` waits for the decode in flight, decodes the open window one last
 * time and returns the whole text. Everything the sidecar's `transcribe`
 * already does (the short-audio floor, the annotation stripping) applies to
 * each decode, since it is the same function.
 */

export const SAMPLE_RATE = 16_000
/** New audio needed before the next decode starts. */
export const MIN_NEW_S = 0.7

export type Partial = { committed: string; tentative: string }

export type LiveSessionDeps = {
  transcribe: (samples: Float32Array) => Promise<string>
  onPartial: (partial: Partial) => void
}

export class LiveSession {
  private chunks: Float32Array[] = []
  private total = 0
  private lastDecodeStartedAt = 0
  private inFlight: Promise<void> | null = null
  private finished = false
  private readonly transcript = new LiveTranscript()

  constructor(private readonly deps: LiveSessionDeps) {}

  feed(samples: Float32Array): void {
    if (this.finished || samples.length === 0) return
    this.chunks.push(samples)
    this.total += samples.length
    this.maybeDecode()
  }

  /** The text so far, for a capture that ends before any decode ran. */
  async finish(): Promise<string> {
    this.finished = true
    await this.inFlight
    const window = this.window()
    const last = window.length > 0 ? await this.deps.transcribe(window) : ''
    return this.transcript.finish(last)
  }

  cancel(): void {
    this.finished = true
    this.chunks = []
    this.total = 0
  }

  private maybeDecode(): void {
    if (this.inFlight || this.finished) return
    if (this.total - this.lastDecodeStartedAt < MIN_NEW_S * SAMPLE_RATE) return
    this.lastDecodeStartedAt = this.total
    this.inFlight = this.decode()
      .catch(() => {
        // A failed partial is not a failed capture: `finish` decodes again,
        // and the error it raises is the one the user sees.
      })
      .finally(() => {
        this.inFlight = null
        this.maybeDecode()
      })
  }

  private async decode(): Promise<void> {
    let window = this.window()
    const cut = cutPoint(window, { sampleRate: SAMPLE_RATE })
    if (cut !== null) {
      const head = window.subarray(0, cut)
      const sealed = await this.deps.transcribe(head)
      if (this.finished) return
      this.transcript.seal(words(sealed))
      this.dropBefore(cut)
      window = this.window()
    }
    const text = await this.deps.transcribe(window)
    if (this.finished) return
    this.transcript.apply(words(text))
    this.deps.onPartial(this.transcript.view())
  }

  /** The open window as one buffer. Chunks are merged in place so repeated calls stay cheap. */
  private window(): Float32Array {
    if (this.chunks.length > 1) {
      const merged = new Float32Array(this.total)
      let offset = 0
      for (const chunk of this.chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      this.chunks = [merged]
    }
    return this.chunks[0] ?? new Float32Array(0)
  }

  private dropBefore(cut: number): void {
    const window = this.window()
    const rest = window.subarray(cut)
    this.chunks = rest.length > 0 ? [rest] : []
    this.total = rest.length
    this.lastDecodeStartedAt = Math.max(0, this.lastDecodeStartedAt - cut)
  }
}
