import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The files an agent's workspace holds, for the `@file` picker.
 *
 * A plain recursive walk rather than a watcher: the list is wanted for the
 * second or two a picker is open, and a watcher per agent is a standing cost
 * for a feature used a few times an hour. The cache makes repeated
 * keystrokes free without making the list minutes stale.
 */

/** Directories no one means when they type `@`. Matched by name at any depth. */
export const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target'
])

/** A monorepo can hold far more; past this the picker is noise anyway. */
export const MAX_INDEXED_FILES = 20_000

/** Every file under `root`, posix-relative and sorted. Missing root → []. */
export async function listWorkspaceFiles(root: string): Promise<string[]> {
  const files: string[] = []

  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_INDEXED_FILES) return
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(join(dir, entry.name), childRel)
      } else if (entry.isFile()) {
        files.push(childRel)
      }
    }
  }

  await walk(root, '')
  return files.sort()
}

export class WorkspaceIndex {
  private readonly cache = new Map<string, { at: number; files: string[] }>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 30_000
    this.now = options.now ?? Date.now
  }

  async files(root: string): Promise<string[]> {
    const hit = this.cache.get(root)
    if (hit && this.now() - hit.at < this.ttlMs) return hit.files
    const files = await listWorkspaceFiles(root)
    this.cache.set(root, { at: this.now(), files })
    return files
  }
}
