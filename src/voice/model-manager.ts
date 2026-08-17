import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  CATALOG,
  findEntry,
  totalBytes,
  type CatalogEntry,
  type ModelFile,
  type ModelStatus
} from '@shared/model-catalog'

/**
 * Downloads and tracks the models the sidecar uses.
 *
 * Lives in the sidecar because that is what consumes the models, and because
 * a multi-hundred-megabyte download has no business competing with the UI
 * thread for attention.
 *
 * Downloads are resumable, checksummed, and clean up after themselves. These
 * files are large enough that a dropped connection is an ordinary event, not
 * an exceptional one, and a half-written model that looks installed is worse
 * than no model at all.
 */

export type DownloadProgress = {
  modelId: string
  receivedBytes: number
  totalBytes: number
}

/** Suffix for in-flight downloads; only a verified file gets the real name. */
const PARTIAL_SUFFIX = '.partial'

export class ModelManager {
  private readonly inFlight = new Map<string, AbortController>()

  constructor(private readonly root = join(homedir(), '.open-room', 'models')) {}

  dirFor(entry: CatalogEntry): string {
    return join(this.root, entry.kind, entry.id)
  }

  pathFor(entry: CatalogEntry, file: ModelFile): string {
    return join(this.dirFor(entry), file.name)
  }

  /** True only when every file of the entry is present at its full size. */
  async isInstalled(entry: CatalogEntry): Promise<boolean> {
    for (const file of entry.files) {
      try {
        const info = await stat(this.pathFor(entry, file))
        // A truncated file would otherwise read as installed and fail later
        // at load time, which is a much more confusing place to discover it.
        if (info.size !== file.sizeBytes) return false
      } catch {
        return false
      }
    }
    return true
  }

  async list(): Promise<ModelStatus[]> {
    const statuses: ModelStatus[] = []

    for (const entry of CATALOG) {
      const downloading = this.inFlight.has(entry.id)
      statuses.push({
        entry,
        state: downloading
          ? 'downloading'
          : (await this.isInstalled(entry))
            ? 'installed'
            : 'missing'
      })
    }

    return statuses
  }

  /**
   * Fetches every file of an entry, resuming any partial download.
   *
   * Rejects if the download is cancelled or a checksum fails; in both cases
   * nothing is left behind that could be mistaken for a usable model.
   */
  async download(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const entry = findEntry(modelId)
    if (!entry) throw new Error(`Unknown model: ${modelId}`)
    if (this.inFlight.has(modelId)) throw new Error(`Already downloading ${modelId}`)

    const controller = new AbortController()
    this.inFlight.set(modelId, controller)

    const expected = totalBytes(entry)
    let completedBytes = 0

    try {
      await mkdir(this.dirFor(entry), { recursive: true })

      for (const file of entry.files) {
        const target = this.pathFor(entry, file)

        // Skip files already present and the right size, so retrying an
        // interrupted multi-file entry does not re-fetch what it has.
        if (await this.hasCompleteFile(target, file.sizeBytes)) {
          completedBytes += file.sizeBytes
          continue
        }

        await this.downloadFile(file, target, controller.signal, (received) => {
          onProgress?.({
            modelId,
            receivedBytes: completedBytes + received,
            totalBytes: expected
          })
        })

        completedBytes += file.sizeBytes
      }
    } catch (error) {
      // Leave no partially-written model behind. The next attempt starts from
      // a known state rather than inheriting whatever the failure produced.
      await rm(this.dirFor(entry), { recursive: true, force: true }).catch(() => {})
      throw error
    } finally {
      this.inFlight.delete(modelId)
    }
  }

  cancel(modelId: string): void {
    this.inFlight.get(modelId)?.abort()
  }

  async remove(modelId: string): Promise<void> {
    const entry = findEntry(modelId)
    if (!entry) return
    this.cancel(modelId)
    await rm(this.dirFor(entry), { recursive: true, force: true })
  }

  private async hasCompleteFile(path: string, expectedSize: number): Promise<boolean> {
    try {
      return (await stat(path)).size === expectedSize
    } catch {
      return false
    }
  }

  /**
   * Downloads one file, resuming from whatever is already on disk.
   *
   * The partial file is only renamed into place after its checksum matches,
   * so an interrupted or corrupted download can never be mistaken for a
   * complete one.
   */
  private async downloadFile(
    file: ModelFile,
    target: string,
    signal: AbortSignal,
    onProgress: (receivedBytes: number) => void
  ): Promise<void> {
    const partial = `${target}${PARTIAL_SUFFIX}`
    let already = 0

    try {
      already = (await stat(partial)).size
    } catch {
      already = 0
    }

    // A partial larger than expected means the file changed upstream or the
    // record is wrong; starting over is the only safe reading.
    if (already > file.sizeBytes) {
      await rm(partial, { force: true })
      already = 0
    }

    const headers: Record<string, string> = {}
    if (already > 0) headers.Range = `bytes=${already}-`

    const response = await fetch(file.url, { headers, signal })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status}) for ${file.name}`)
    }

    // A server that ignores Range replies 200 with the whole file; appending
    // to what we have would corrupt it, so restart from zero instead.
    const resuming = response.status === 206
    if (already > 0 && !resuming) already = 0

    let received = already
    onProgress(received)

    const sink = createWriteStream(partial, { flags: resuming && already > 0 ? 'a' : 'w' })
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])

    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress(received)
    })

    await pipeline(source, sink, { signal })

    const digest = await sha256Of(partial)
    // An empty expected hash means the catalog has not been verified yet;
    // size is then the only check available, and is applied by the caller.
    if (file.sha256 && digest !== file.sha256) {
      await rm(partial, { force: true })
      throw new Error(`Checksum mismatch for ${file.name}`)
    }

    await rename(partial, target)
  }
}

export async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}
