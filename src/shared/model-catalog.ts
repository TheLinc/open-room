/**
 * The catalog of downloadable models.
 *
 * Nothing here ships inside the installer. Voice and speech-to-text models
 * are large, and — for an open-source project — they carry their own upstream
 * licences, so users fetch them from the original source rather than
 * receiving a redistributed copy from us.
 *
 * The catalog is curated rather than a mirror of everything upstream offers:
 * every entry is something we have checked the licence of and are willing to
 * point people at.
 */
import { MODEL_HASHES } from './model-hashes'

export type ModelKind = 'voice' | 'stt' | 'vad'

export type ModelFile = {
  /**
   * Path on disk inside the model's own directory. May contain forward
   * slashes: transformers.js resolves `onnx/encoder_model.onnx` literally
   * under `localModelPath`, so the upstream layout has to be preserved.
   */
  name: string
  url: string
  /** Lowercase hex SHA-256. Verified after download; a mismatch discards it. */
  sha256: string
  sizeBytes: number
}

export type CatalogEntry = {
  id: string
  kind: ModelKind
  label: string
  description: string
  /** SPDX identifier where one applies, else a short human phrase. */
  license: string
  /** Who to credit, shown in the UI and collected into NOTICE. */
  attribution: string
  /** Where the model came from, so a user can check it themselves. */
  homepage: string
  files: ModelFile[]
}

export type InstalledState = 'missing' | 'downloading' | 'installed'

export type ModelStatus = {
  entry: CatalogEntry
  state: InstalledState
  /** 0–1 while downloading. */
  progress?: number
}

/** One file whose size and checksum come from the generated record. */
function recordedFile(id: string, name: string, url: string): ModelFile {
  const recorded = MODEL_HASHES[`${id}/${name}`]
  return { name, url, sha256: recorded?.sha256 ?? '', sizeBytes: recorded?.sizeBytes ?? 0 }
}

/**
 * Speech-to-text models.
 *
 * These are ONNX conversions, not GGML weights for a native runtime: `stt.ts`
 * runs the model on transformers.js and onnxruntime, the stack Kokoro already
 * uses, so voice input costs a model download rather than a second inference
 * engine and a native binding.
 *
 * Quantised variants are deliberately absent. The same measurement that
 * decided Kokoro applies here — int8 has no fast path on this runtime and is
 * markedly slower than fp32 — so the smaller file would buy a worse model.
 * That is why "tiny" still means 147 MB.
 */
const MOONSHINE = 'https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main'

/**
 * The files transformers.js fetches for the ASR pipeline at `dtype: 'fp32'`:
 * what it wrote to a scratch cache when it loaded `moonshine-base-ONNX`, no
 * more and nothing missing. Largest first, so a failed download fails early.
 */
const MOONSHINE_FILES = [
  'onnx/decoder_model_merged.onnx',
  'onnx/encoder_model.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'generation_config.json',
  'preprocessor_config.json'
] as const

/**
 * The speech-to-text model the app runs. One id rather than a setting: the
 * sidecar loads it and the settings dialog describes its download, and the
 * two must agree.
 *
 * Moonshine rather than Whisper, on measurement (2026-09-11, three clips of
 * 5, 13 and 42 s): the same words as Whisper tiny, with punctuation and
 * casing, at a cost that scales with the audio rather than Whisper's fixed
 * 30 s window (1 s of audio decoded in 55 ms against Whisper's 280 ms), which
 * is what makes re-decoding the live buffer once a second affordable. The
 * Whisper entries were removed once nothing loaded them (0.5.0 shipped
 * Moonshine); a leftover `stt/whisper-*` directory is inert.
 */
export const STT_MODEL_ID = 'moonshine-base-en'

export const CATALOG: CatalogEntry[] = [
  {
    id: 'moonshine-base-en',
    kind: 'stt',
    label: 'Moonshine Base (English)',
    description: 'Fast, with punctuation. Live transcript while you talk.',
    license: 'MIT',
    attribution: 'Moonshine — Useful Sensors; ONNX conversion by onnx-community',
    homepage: 'https://huggingface.co/onnx-community/moonshine-base-ONNX',
    files: MOONSHINE_FILES.map((name) =>
      recordedFile('moonshine-base-en', name, `${MOONSHINE}/${name}`)
    )
  },
  {
    id: 'silero-vad',
    kind: 'vad',
    label: 'Silero VAD',
    description:
      'Decides which sounds are speech, so the speech model only runs on the ones that are.',
    license: 'MIT',
    attribution: 'Silero VAD — Silero Team; ONNX conversion by onnx-community',
    homepage: 'https://huggingface.co/onnx-community/silero-vad',
    files: [
      recordedFile(
        'silero-vad',
        'silero_vad.onnx',
        'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx'
      )
    ]
  }
]

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id)
}

export function totalBytes(entry: CatalogEntry): number {
  return entry.files.reduce((sum, file) => sum + file.sizeBytes, 0)
}

/** Rounded to one decimal above a gigabyte, whole megabytes below it. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
