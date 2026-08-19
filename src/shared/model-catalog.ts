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

const TINY = 'https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main'
const BASE = 'https://huggingface.co/onnx-community/whisper-base.en/resolve/main'

/**
 * The files transformers.js fetches for an ASR pipeline at `dtype: 'fp32'`.
 *
 * Derived rather than guessed: the pipeline was run once against a scratch
 * cache and this is exactly what it wrote — no more, and nothing missing. The
 * two repositories share a layout, so one list serves both. Largest first, so
 * a failed download fails early rather than after the small files succeed.
 */
const WHISPER_FILES = [
  'onnx/decoder_model_merged.onnx',
  'onnx/encoder_model.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'generation_config.json',
  'preprocessor_config.json'
] as const

/** One file whose size and checksum come from the generated record. */
function recordedFile(id: string, name: string, url: string): ModelFile {
  const recorded = MODEL_HASHES[`${id}/${name}`]
  return { name, url, sha256: recorded?.sha256 ?? '', sizeBytes: recorded?.sizeBytes ?? 0 }
}

/** Sizes and checksums come from the generated record, not from here. */
function whisperFiles(id: string, base: string): ModelFile[] {
  return WHISPER_FILES.map((name) => {
    const recorded = MODEL_HASHES[`${id}/${name}`]
    return {
      name,
      url: `${base}/${name}`,
      sha256: recorded?.sha256 ?? '',
      sizeBytes: recorded?.sizeBytes ?? 0
    }
  })
}

/**
 * Speech-to-text models.
 *
 * These are the ONNX conversions, not whisper.cpp's GGML weights: `stt.ts`
 * runs Whisper on transformers.js and onnxruntime, the stack Kokoro already
 * uses, so voice input costs a model download rather than a second inference
 * engine and a native binding.
 *
 * Quantised variants are deliberately absent. The same measurement that
 * decided Kokoro applies here — int8 has no fast path on this runtime and is
 * markedly slower than fp32 — so the smaller file would buy a worse model.
 * That is why "tiny" still means 147 MB.
 */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'whisper-tiny-en',
    kind: 'stt',
    label: 'Whisper Tiny (English)',
    description: 'Fastest. Enough for wake words and short commands.',
    license: 'Apache-2.0',
    attribution: 'Whisper — OpenAI; ONNX conversion by onnx-community',
    homepage: 'https://huggingface.co/onnx-community/whisper-tiny.en',
    files: whisperFiles('whisper-tiny-en', TINY)
  },
  {
    id: 'whisper-base-en',
    kind: 'stt',
    label: 'Whisper Base (English)',
    description: 'More accurate on longer sentences. Roughly twice the size.',
    license: 'Apache-2.0',
    attribution: 'Whisper — OpenAI; ONNX conversion by onnx-community',
    homepage: 'https://huggingface.co/onnx-community/whisper-base.en',
    files: whisperFiles('whisper-base-en', BASE)
  },
  {
    id: 'silero-vad',
    kind: 'vad',
    label: 'Silero VAD',
    description: 'Decides which sounds are speech, so Whisper only runs on the ones that are.',
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
