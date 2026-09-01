import type { TranscriptEntry } from './agent-runtime'

/**
 * What a turn wrote, read off the transcript.
 *
 * The receipt under a finished turn. Derived from the `tool_use` blocks
 * already on screen rather than from a filesystem watcher: the transcript is
 * the record of what the agent did, and a watcher would also see the user's
 * own editor saving.
 */

export type ChangedFile = {
  path: string
  /** First touched by Write, so it is (probably) new. Edit implies it existed. */
  created: boolean
}

/** Tools that write, and the input field naming the file. */
const WRITERS: Record<string, { field: string; creates: boolean }> = {
  Write: { field: 'file_path', creates: true },
  Edit: { field: 'file_path', creates: false },
  MultiEdit: { field: 'file_path', creates: false },
  NotebookEdit: { field: 'notebook_path', creates: false }
}

type Block = { type?: string; name?: string; input?: Record<string, unknown> }

export function filesChangedIn(messages: unknown[]): ChangedFile[] {
  const seen = new Map<string, ChangedFile>()
  for (const message of messages) {
    const m = message as { type?: string; message?: { content?: unknown } } | null
    if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) continue
    for (const block of m.message.content as Block[]) {
      if (block.type !== 'tool_use' || !block.name) continue
      const writer = WRITERS[block.name]
      if (!writer) continue
      const path = block.input?.[writer.field]
      if (typeof path !== 'string' || !path) continue
      if (!seen.has(path)) seen.set(path, { path, created: writer.creates })
    }
  }
  return [...seen.values()]
}

/**
 * Whether an entry is a prompt the user sent (not a tool result echo or an
 * injected compaction summary).
 *
 * This is the turn boundary for both the live transcript, where a turn ends
 * at the SDK's `result` message, and the persisted one, which carries no
 * `result` at all — there a turn's end is inferred from where the *next*
 * prompt starts, and this is that check.
 */
export function isPrompt(entry: TranscriptEntry): boolean {
  const m = entry.message as {
    type?: string
    isSynthetic?: boolean
    message?: { content?: unknown }
  } | null
  if (m?.type !== 'user') return false
  // Injected compaction summaries are not prompts, despite their user type
  if (m.isSynthetic) return false
  const content = m.message?.content
  if (typeof content === 'string') return true
  return Array.isArray(content) && !content.every((b) => (b as Block).type === 'tool_result')
}

/**
 * The entries belonging to the turn that ends at `resultIndex`: everything
 * after the previous prompt, up to but not including the result.
 *
 * The result entry is excluded because it never carries a tool_use, so nothing
 * is lost by not including it.
 */
export function turnBefore(entries: TranscriptEntry[], resultIndex: number): TranscriptEntry[] {
  let start = resultIndex
  while (start > 0 && !isPrompt(entries[start - 1])) start -= 1
  return entries.slice(start, resultIndex)
}

/**
 * How a changed file is labelled: relative to the conversation's checkout
 * when it is inside it, otherwise as the agent wrote it.
 *
 * The tool input is usually an absolute path, and a worktree lives under
 * `~/.open-room/worktrees/<agent>/<slug>/…` — a label nobody can read at a
 * glance. Display only: actions still use the full path. Case-insensitive
 * on the root because Windows and macOS filesystems are.
 */
export function displayPath(path: string, cwd: string): string {
  const file = path.split('\\').join('/')
  const root = cwd.split('\\').join('/').replace(/\/+$/, '')
  const inside =
    root !== '' &&
    file.toLowerCase().startsWith(root.toLowerCase() + '/') &&
    file.length > root.length + 1
  return inside ? file.slice(root.length + 1) : path
}
