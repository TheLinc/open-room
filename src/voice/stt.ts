import { homedir } from 'node:os'
import { join } from 'node:path'
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { STT_MODEL_ID } from '@shared/model-catalog'

/**
 * Speech to text on transformers.js and onnxruntime, the same stack Kokoro
 * already uses, so voice input adds a model download rather than a second
 * inference engine. The plan originally called for whisper.cpp, which would
 * have meant native bindings and a separate binary for no measured benefit.
 *
 * The model is Moonshine (`STT_MODEL_ID` in the catalog), chosen over
 * Whisper tiny on measurement: the same words, with punctuation and casing,
 * at a cost that scales with the audio rather than Whisper's fixed 30 s
 * window, which is what lets `LiveSession` decode the growing capture once a
 * second. Whisper tiny is back for wake segments only (`WAKE_MODEL_ID`).
 */

/** The model is trained on 16 kHz mono; anything else must be resampled first. */
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

/**
 * One pipeline per model id: Moonshine for dictation and, when installed,
 * Whisper tiny for wake segments (`WAKE_MODEL_ID`).
 */
const instances = new Map<string, AutomaticSpeechRecognitionPipeline>()
const loading = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()

export function isSttLoaded(modelId: string = STT_MODEL_ID): boolean {
  return instances.has(modelId)
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
 * `moonshine-base-en` resolves to `<models>/stt/moonshine-base-en/`.
 */
export function loadStt(
  modelId: string,
  onProgress?: (progress: number | undefined) => void
): Promise<AutomaticSpeechRecognitionPipeline> {
  const loaded = instances.get(modelId)
  if (loaded) return Promise.resolve(loaded)

  let pending = loading.get(modelId)
  if (!pending) {
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = sttModelRoot()

    pending = pipeline('automatic-speech-recognition', modelId, {
      dtype: 'fp32',
      device: 'cpu',
      progress_callback: (report) => {
        const progress = (report as { progress?: number }).progress
        onProgress?.(typeof progress === 'number' ? progress / 100 : undefined)
      }
    })
      .then((asr) => {
        instances.set(modelId, asr)
        return asr
      })
      .catch((error) => {
        // Clear the shared promise so a failed load can be retried rather
        // than every later caller inheriting the same rejection.
        loading.delete(modelId)
        throw error
      })
    loading.set(modelId, pending)
  }

  return pending
}

/**
 * Transcribes 16 kHz mono float samples.
 *
 * Returns the empty string for audio too short to contain speech, which is
 * what a mis-tapped hotkey produces. Dispatching an empty prompt to an agent
 * would be worse than doing nothing.
 */
export async function transcribe(
  samples: Float32Array,
  modelId: string = STT_MODEL_ID
): Promise<string> {
  if (samples.length < STT_SAMPLE_RATE * 0.2) return ''

  // Loading is the caller's job: it needs a model id, and doing it here would
  // hide a 147 MB download behind what looks like a transcription call.
  const instance = instances.get(modelId)
  if (!instance) throw new Error('No speech-to-text model is loaded.')

  // No chunking options: Moonshine has no fixed window and takes the audio
  // as it is, and Whisper only ever gets a wake segment, which the segmenter
  // caps at 15 s. (Whisper's pipeline truncates at 30 s unless told to
  // chunk: measured, 84 of 118 words on a 42 s clip, with no error.)
  const result = await instance(samples)
  const text = Array.isArray(result) ? result[0]?.text : result.text

  return cleanTranscript(text ?? '')
}

/**
 * Strips the model's bracketed annotations for non-speech audio — `[BLANK_AUDIO]`,
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
