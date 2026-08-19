import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Voice activity detection via Silero.
 *
 * This is the gate that makes always-on listening affordable. Whisper costs
 * hundreds of milliseconds per segment; Silero costs 0.15 ms per 32 ms frame
 * — measured, a real-time factor of roughly 0.005 — so running it on
 * everything and Whisper only on what it accepts is three orders of magnitude
 * cheaper than transcribing every noise in the room.
 *
 * It also rejects what an amplitude gate cannot. A 220 Hz tone at half scale
 * scores 0.07 here: loud, and obviously not speech. Music, typing and a fan
 * are exactly the sounds a wake word must not wake on.
 */

/** Silero v5 consumes exactly this many samples per frame at 16 kHz. */
export const VAD_FRAME = 512

/** Frames above this are speech. Silero's own recommended operating point. */
const SPEECH_THRESHOLD = 0.5

/** The model's recurrent state: [2, batch, 128], zeroed at the start of a segment. */
const STATE_SHAPE = [2, 1, 128] as const

export function vadModelRoot(): string {
  const root = process.env.OPEN_ROOM_MODELS || join(homedir(), '.open-room', 'models')
  return join(root, 'vad')
}

export function vadModelPath(modelId = 'silero-vad'): string {
  return join(vadModelRoot(), modelId, 'silero_vad.onnx')
}

type Session = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: ArrayLike<number> }>>
}

let session: Session | null = null
let loading: Promise<Session> | null = null

export function isVadLoaded(): boolean {
  return session !== null
}

/**
 * onnxruntime is imported on first use, not at module load.
 *
 * It is a native module and pulls a substantial binary; importing it eagerly
 * would delay sidecar startup for every user, including the majority who
 * never turn wake words on.
 */
export async function loadVad(modelId = 'silero-vad'): Promise<void> {
  if (session) return

  if (!loading) {
    loading = (async () => {
      const ort = await import('onnxruntime-node')
      const created = await ort.InferenceSession.create(vadModelPath(modelId))
      return created as unknown as Session
    })()
  }

  try {
    session = await loading
  } finally {
    loading = null
  }
}

/** Frees the model. Wake words being switched off should not cost 2 MB forever. */
export function unloadVad(): void {
  session = null
}

/**
 * The shortest run of speech worth waking Whisper for.
 *
 * A wake phrase is short — "Hey Derek" is around 650 ms of voiced audio — and
 * 250 ms is comfortably under any real word while being far more than the
 * stray frame a door or a keystroke produces.
 */
export const MIN_SPEECH_MS = 250

/** How much audio one Silero frame covers, in milliseconds. */
export function frameMs(): number {
  return (VAD_FRAME / 16000) * 1000
}

/**
 * Whether this many speech frames is enough, given the segment they came from.
 *
 * Deliberately a count and not a proportion. The segmenter pads every
 * utterance by design — 500 ms of pre-roll so the onset survives, 700 ms of
 * hang before it closes, and whatever silence has accumulated since the last
 * idle flush — so a ratio scores the same phrase differently depending on how
 * quiet the room was beforehand. Measured against the real model, "Hey Derek"
 * scored 0.435 alone and 0.174 in the segment the app actually cut, which put
 * it under a 0.25 ratio bar and dropped it. How much speech there was does not
 * depend on what surrounds it.
 *
 * `total` is accepted so an empty segment can be rejected outright rather than
 * relying on a frame count that would be zero anyway.
 */
export function acceptsSpeech(speechFrames: number, total: number, minMs = MIN_SPEECH_MS): boolean {
  if (total <= 0) return false
  return speechFrames * frameMs() >= minMs
}

/**
 * How many frames of a segment Silero judged to be speech, and how many there were.
 *
 * State is threaded frame to frame and reset per segment, which is how Silero
 * is meant to be driven — it is recurrent, and feeding it independent frames
 * throws away the context that makes it better than an amplitude gate.
 */
export async function speechFrames(
  samples: Float32Array
): Promise<{ speech: number; total: number }> {
  if (!session) throw new Error('No voice-activity model is loaded.')
  if (samples.length < VAD_FRAME) return { speech: 0, total: 0 }

  const ort = await import('onnxruntime-node')
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [...STATE_SHAPE])
  const sampleRate = new ort.Tensor('int64', BigInt64Array.from([16000n]), [])

  let frames = 0
  let speech = 0

  for (let offset = 0; offset + VAD_FRAME <= samples.length; offset += VAD_FRAME) {
    const frame = samples.subarray(offset, offset + VAD_FRAME)
    const output = await session.run({
      input: new ort.Tensor('float32', Float32Array.from(frame), [1, VAD_FRAME]),
      state,
      sr: sampleRate
    })

    state = output.stateN as unknown as typeof state
    if (Number(output.output.data[0]) > SPEECH_THRESHOLD) speech += 1
    frames += 1
  }

  return { speech, total: frames }
}

/**
 * Whether a segment is worth transcribing.
 *
 * A run of speech rather than any single frame: a lone frame crossing the
 * threshold is what a door closing looks like. A quarter of a second is a low
 * bar deliberately — this gate exists to reject rooms, not to decide what was
 * said.
 */
export async function isSpeech(samples: Float32Array, minMs = MIN_SPEECH_MS): Promise<boolean> {
  const { speech, total } = await speechFrames(samples)
  return acceptsSpeech(speech, total, minMs)
}
