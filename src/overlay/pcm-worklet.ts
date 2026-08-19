/**
 * Collects raw mono samples for the length of one capture.
 *
 * An AudioWorklet rather than a ScriptProcessorNode: the latter is deprecated
 * and runs its callback on the main thread, which is exactly where the
 * waveform is being animated. Dropping audio because a React render ran long
 * is not a trade worth making.
 *
 * The processor keeps every frame and hands the lot over on `flush`, rather
 * than streaming chunks across the port. Whisper needs the whole utterance
 * before it can transcribe anything, so streaming would buy latency we cannot
 * spend and cost a message per 8 ms.
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

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<WorkletCommand>): void => {
      const command = event.data

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
      this.port.postMessage(merged, [merged.buffer])
    }
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
    return true
  }
}

registerProcessor('pcm-collector', PcmCollector)
