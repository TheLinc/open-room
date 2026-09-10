import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArchiveMap } from '@shared/archive'

/**
 * The per-agent record of archived conversations.
 *
 * Same shape as the worktree records: one JSON file beside the agent's
 * config, keyed by session id, read whole and written whole. The SDK's
 * session metadata is Claude Code's to change, and a tag would be visible
 * to terminal Claude Code in the same folder, so the archive state stays
 * Open Room's own file.
 */

export const ARCHIVE_FILE = 'archive.json'

/** The part the sweeper needs, so its test can hand in a map. */
export type ArchiveReader = { read(agentId: string): Promise<ArchiveMap> }

function isMap(value: unknown): value is ArchiveMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(
    (record) =>
      typeof record === 'object' &&
      record !== null &&
      typeof (record as { archivedAt?: unknown }).archivedAt === 'number'
  )
}

export class ArchiveStore implements ArchiveReader {
  constructor(private readonly agentDir: (agentId: string) => string) {}

  async read(agentId: string): Promise<ArchiveMap> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file(agentId), 'utf8'))
      return isMap(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  /** Archives a session. Archiving one already archived keeps its first time. */
  async archive(agentId: string, sessionId: string, now: number = Date.now()): Promise<void> {
    const map = await this.read(agentId)
    if (map[sessionId]) return
    await this.write(agentId, { ...map, [sessionId]: { archivedAt: now } })
  }

  /** Restores a session to the live list. */
  async restore(agentId: string, sessionId: string): Promise<void> {
    await this.forget(agentId, sessionId)
  }

  /** Drops the record, for a restore or for a session that is gone. */
  async forget(agentId: string, sessionId: string): Promise<void> {
    const map = await this.read(agentId)
    if (!(sessionId in map)) return
    const { [sessionId]: _dropped, ...rest } = map
    void _dropped
    await this.write(agentId, rest)
  }

  private async write(agentId: string, map: ArchiveMap): Promise<void> {
    await mkdir(this.agentDir(agentId), { recursive: true })
    await writeFile(this.file(agentId), JSON.stringify(map, null, 2) + '\n', 'utf8')
  }

  private file(agentId: string): string {
    return join(this.agentDir(agentId), ARCHIVE_FILE)
  }
}
