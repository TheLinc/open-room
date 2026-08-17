import { homedir } from 'node:os'
import { join } from 'node:path'
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

/**
 * Speech to text via Whisper.
 *
 * Runs on transformers.js and onnxruntime, the same stack Kokoro already
 * uses, so voice input adds a model download rather than a second inference
 * engine. The plan originally called for whisper.cpp, which would have meant
 * native bindings and a separate binary for no measured benefit.
 *
 * `tiny.en` is the default on measurement: for a 2.6s clip it transcribed in
 * 387ms against `base.en`'s 621ms, with identical output on the samples
 * tested. Wake words and short commands are what this handles, and tiny is
 * comfortably accurate enough for them.
 */

const MODEL_ID = 'onnx-community/whisper-tiny.en'

/** Whisper is trained on 16 kHz mono; anything else must be resampled first. */
export const STT_SAMPLE_RATE = 16_000

env.cacheDir = process.env.OPEN_ROOM_MODELS || join(homedir(), '.open-room', 'models', 'kokoro')

let instance: AutomaticSpeechRecognitionPipeline | null = null
let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null

export function isSttLoaded(): boolean {
  return instance !== null
}

export function loadStt(
  onProgress?: (progress: number | undefined) => void
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (instance) return Promise.resolve(instance)

  if (!loading) {
    loading = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'fp32',
      device: 'cpu',
      progress_callback: (report) => {
        const progress = (report as { progress?: number }).progress
        onProgress?.(typeof progress === 'number' ? progress / 100 : undefined)
      }
    })
      .then((asr) => {
        instance = asr
        return asr
      })
      .catch((error) => {
        // Clear the shared promise so a failed download can be retried rather
        // than every later caller inheriting the same rejection.
        loading = null
        throw error
      })
  }

  return loading
}

/**
 * Transcribes 16 kHz mono float samples.
 *
 * Returns the empty string for audio too short to contain speech, which is
 * what a mis-tapped hotkey produces. Dispatching an empty prompt to an agent
 * would be worse than doing nothing.
 */
export async function transcribe(samples: Float32Array): Promise<string> {
  if (samples.length < STT_SAMPLE_RATE * 0.2) return ''

  const asr = await loadStt()
  const result = await asr(samples)
  const text = Array.isArray(result) ? result[0]?.text : result.text

  return cleanTranscript(text ?? '')
}

/**
 * Strips Whisper's bracketed annotations for non-speech audio — `[BLANK_AUDIO]`,
 * `(wind blowing)` and similar. They are transcription metadata, not something
 * anyone said, and passing them to an agent as a prompt would be nonsense.
 */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
