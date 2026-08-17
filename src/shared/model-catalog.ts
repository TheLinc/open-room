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

export type ModelKind = 'voice' | 'stt'

export type ModelFile = {
  /** Filename on disk, inside the model's own directory. */
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

/**
 * Speech-to-text models for Phase 5.
 *
 * whisper.cpp's GGML conversions are MIT, same as whisper.cpp itself, and are
 * published by its author — an unambiguous licence, which is why these are in
 * the catalog while other candidates are not.
 */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'whisper-tiny-en',
    kind: 'stt',
    label: 'Whisper Tiny (English)',
    description: 'Fastest. Enough for wake words and short commands.',
    license: 'MIT',
    attribution: 'whisper.cpp — Georgi Gerganov',
    homepage: 'https://huggingface.co/ggerganov/whisper.cpp',
    files: [
      {
        name: 'ggml-tiny.en.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
        // Filled in by `npm run verify:catalog`, which downloads each file
        // once and records what it actually got.
        sha256: '',
        sizeBytes: 77_704_715
      }
    ]
  },
  {
    id: 'whisper-base-en',
    kind: 'stt',
    label: 'Whisper Base (English)',
    description: 'More accurate on longer sentences. Roughly twice the size.',
    license: 'MIT',
    attribution: 'whisper.cpp — Georgi Gerganov',
    homepage: 'https://huggingface.co/ggerganov/whisper.cpp',
    files: [
      {
        name: 'ggml-base.en.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
        sha256: '',
        sizeBytes: 147_951_465
      }
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
