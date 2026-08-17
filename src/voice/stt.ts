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

/** Whisper is trained on 16 kHz mono; anything else must be resampled first. */
export const STT_SAMPLE_RATE = 16_000

/**
 * Where `ModelManager` installs speech-to-text models.
 *
 * Read at call time rather than at module load, so relocating the models root
 * — which is how tests drive this without touching a real home directory —
 * takes effect.
 */
export function sttModelRoot(): string {
  const root = process.env.OPEN_ROOM_MODELS || join(homedir(), '.open-room', 'models')
  return join(root, 'stt')
}

let instance: AutomaticSpeechRecognitionPipeline | null = null
let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null

export function isSttLoaded(): boolean {
  return instance !== null
}

/**
 * Loads a model that is already on disk.
 *
 * Remote loading is disabled deliberately. Acquisition belongs to
 * `ModelManager`, which verifies a sha256 and can resume a 147 MB download;
 * transformers.js fetching its own copy would bypass both and put a second
 * copy in a second cache directory.
 *
 * `modelId` is the catalog id, which is also the directory name — so
 * `whisper-tiny-en` resolves to `<models>/stt/whisper-tiny-en/`.
 */
export function loadStt(
  modelId: string,
  onProgress?: (progress: number | undefined) => void
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (instance) return Promise.resolve(instance)

  if (!loading) {
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = sttModelRoot()

    loading = pipeline('automatic-speech-recognition', modelId, {
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
        // Clear the shared promise so a failed load can be retried rather
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

  // Loading is the caller's job: it needs a model id, and doing it here would
  // hide a 147 MB download behind what looks like a transcription call.
  if (!instance) throw new Error('No speech-to-text model is loaded.')

  const result = await instance(samples)
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
