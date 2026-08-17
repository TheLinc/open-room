import { homedir } from 'node:os'
import { join } from 'node:path'
import { KokoroTTS } from 'kokoro-js'
// Imported from transformers rather than kokoro-js's re-export: the re-export
// is narrowed and does not expose `cacheDir`.
import { env } from '@huggingface/transformers'
import { DEFAULT_KOKORO_VOICE } from '@shared/kokoro-voices'

/**
 * Neural speech via Kokoro.
 *
 * Chosen over Piper after measuring both: Piper's maintained build is GPL-3.0
 * and ships only as a Python wheel, and its voices carry a patchwork of
 * dataset licences including non-commercial ones. Kokoro is Apache-2.0
 * throughout — engine, weights and voices — and runs in-process through
 * onnxruntime, which the sidecar needs anyway for Silero VAD.
 *
 * `fp16` is not an arbitrary default. Measured on a 12-core desktop for a
 * 2.4s utterance: q8 1883ms, fp16 624ms, fp32 586ms. The smallest
 * quantisation is by far the slowest — int8 has no fast path here — so fp16
 * is the size/speed sweet spot at 163 MB.
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const DTYPE = 'fp16'

export type LoadProgress = {
  file: string
  /** 0–1, or undefined for phases that do not report a total. */
  progress?: number
}

let instance: KokoroTTS | null = null
let loading: Promise<KokoroTTS> | null = null

/**
 * Where model weights are cached.
 *
 * Configured on import rather than by the caller: this module is loaded
 * lazily, and transformers.js reads `cacheDir` when the model loads, so by
 * the time anything here runs the value must already be right.
 */
env.cacheDir = process.env.OPEN_ROOM_MODELS || join(homedir(), '.open-room', 'models', 'kokoro')

export function isKokoroLoaded(): boolean {
  return instance !== null
}

/**
 * Loads the model, downloading it on first use.
 *
 * Concurrent callers share one load: the weights are large enough that
 * racing downloads would be a real waste, and the first `speak` after a fresh
 * install can easily overlap with a UI request for model status.
 */
export function loadKokoro(onProgress?: (progress: LoadProgress) => void): Promise<KokoroTTS> {
  if (instance) return Promise.resolve(instance)

  if (!loading) {
    loading = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      device: 'cpu',
      progress_callback: (report: { file?: string; progress?: number; status?: string }) => {
        onProgress?.({
          file: report.file ?? '',
          progress: typeof report.progress === 'number' ? report.progress / 100 : undefined
        })
      }
    })
      .then((tts) => {
        instance = tts
        return tts
      })
      .catch((error) => {
        // Clear the shared promise so a failed download can be retried
        // instead of every later caller inheriting the same rejection.
        loading = null
        throw error
      })
  }

  return loading
}

/**
 * Synthesises to a WAV file.
 *
 * `rate` follows the app-wide convention where 1 is natural and higher is
 * slower. Kokoro's `speed` runs the other way — verified by measurement, not
 * assumption — so it is inverted here.
 */
export async function synthesizeKokoro(
  text: string,
  options: { voiceId?: string; rate: number },
  outPath: string
): Promise<void> {
  const tts = await loadKokoro()
  const voice = options.voiceId || DEFAULT_KOKORO_VOICE

  const audio = await tts.generate(text, {
    voice: voice as NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice'],
    speed: 1 / Math.max(0.5, options.rate)
  })

  await audio.save(outPath)
}
