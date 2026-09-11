/**
 * Collects raw mono samples for the length of one capture.
 *
 * An AudioWorklet rather than a ScriptProcessorNode: the latter is deprecated
 * and runs its callback on the main thread, which is exactly where the
 * waveform is being animated. Dropping audio because a React render ran long
 * is not a trade worth making.
 *
 * Two modes. Always-on listening keeps every frame and hands the lot over
 * on `flush`, since a segment is judged whole. A push-to-talk capture
 * streams: once told to, the processor posts a chunk every `everySamples`
 * (300 ms, not one per 8 ms quantum) so the sidecar can decode the
 * transcript while the user is still talking, and `flush` returns only
 * what came after the last chunk.
 */

/**
 * AudioWorkletGlobalScope is not part of TypeScript's DOM library, so its two
 * globals are declared here. Module-scoped `declare`s, so nothing leaks into
 * the rest of the renderer, where neither exists.
 */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
}

/** What the document can ask of this processor. */
type WorkletCommand =
  /** Hand over everything collected and start again empty. */
  | { type: 'flush' }
  /** Throw away everything but the last `keepSamples`, as pre-roll. */
  | { type: 'drop'; keepSamples?: number }
  /** Post a chunk every `everySamples` instead of holding the audio. */
  | { type: 'stream'; everySamples: number }

/** What the processor posts back. */
export type WorkletMessage = { type: 'chunk' | 'flush'; samples: Float32Array }
declare function registerProcessor(name: string, constructor: new () => AudioWorkletProcessor): void

/**
 * A hard ceiling on retained audio, in samples — 60 s at 16 kHz.
 *
 * The endpointer stops a capture well before this, but it runs in the document
 * and this runs in the audio thread. If the document wedges, the microphone
 * keeps feeding this processor with nothing left to stop it, and unbounded
 * growth in the audio thread takes the whole context down with it.
 */
const MAX_SAMPLES = 16_000 * 60

class PcmCollector extends AudioWorkletProcessor {
  private chunks: Float32Array[] = []
  private length = 0
  /** Streaming when set: the chunk size to post at. */
  private streamEvery = 0

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<WorkletCommand>): void => {
      const command = event.data

      if (command.type === 'stream') {
        this.streamEvery = command.everySamples
        return
      }

      if (command.type === 'drop') {
        // Everything but a tail of pre-roll. Always-on listening throws away
        // most of what it hears, but the moment before someone starts talking
        // holds the beginning of the first word — cutting there clips it.
        this.keepTail(command.keepSamples ?? 0)
        return
      }

      const merged = this.take()
      // Transferred rather than copied: a 30 s capture is 1.9 MB, and
      // structured-cloning it would duplicate that on the document's heap.
      this.post('flush', merged)
    }
  }

  private post(type: WorkletMessage['type'], samples: Float32Array): void {
    const message: WorkletMessage = { type, samples }
    this.port.postMessage(message, [samples.buffer])
  }

  /** Everything collected so far, emptying the buffer. */
  private take(): Float32Array {
    const merged = new Float32Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    this.chunks = []
    this.length = 0
    return merged
  }

  /** Discards all but the most recent `samples`. */
  private keepTail(samples: number): void {
    if (samples <= 0) {
      this.chunks = []
      this.length = 0
      return
    }

    while (this.length - (this.chunks[0]?.length ?? 0) >= samples && this.chunks.length > 1) {
      this.length -= this.chunks.shift()!.length
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel || channel.length === 0) return true
    if (this.length >= MAX_SAMPLES) return true

    // The render quantum is reused between calls, so it has to be copied.
    this.chunks.push(new Float32Array(channel))
    this.length += channel.length
    if (this.streamEvery > 0 && this.length >= this.streamEvery) this.post('chunk', this.take())
    return true
  }
}

registerProcessor('pcm-collector', PcmCollector)
