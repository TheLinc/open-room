/**
 * `@file` references in a draft.
 *
 * The text is sent exactly as typed. Open Room does not expand the file into
 * the prompt: the agent has Read, and pasting contents would both duplicate
 * them into the context window and alter what the user said. What this file
 * owns is the picker — when it opens, what it offers, what a pick inserts —
 * and how a dropped path is spelled.
 */

export type Mention = {
  /** Index of the `@`. */
  start: number
  /** Index just past the query (the caret). */
  end: number
  query: string
}

/**
 * The mention the caret is inside, if any.
 *
 * Only an `@` at the start or after whitespace counts — `me@example.com` is
 * not a request for a file, but `@radix-ui` typed after a space does open the
 * picker, which closes once the user types a space. The word must run up to the
 * caret; once the user has typed a space the picker closes.
 */
export function mentionAt(draft: string, caret: number): Mention | null {
  const before = draft.slice(0, caret)
  const match = /(^|\s)@(\S*)$/.exec(before)
  if (!match) return null
  const start = caret - match[2].length - 1
  return { start, end: caret, query: match[2] }
}

/** Whether every character of `query` appears in `text`, in order. */
function subsequence(text: string, query: string): boolean {
  let i = 0
  for (const ch of text) {
    if (ch === query[i]) i += 1
    if (i === query.length) return true
  }
  return query.length === 0
}

/**
 * Workspace files matching a query, best first.
 *
 * Subsequence matching, like every fuzzy file finder: `smipc` finds
 * `src/main/ipc.ts`. A match in the basename outranks one only in the
 * directory, because people remember file names before folder names.
 */
export function filterFiles(files: string[], query: string, limit = 12): string[] {
  const q = query.toLowerCase()
  if (!q) return files.slice(0, limit)

  const scored: { file: string; score: number }[] = []
  for (const file of files) {
    const lower = file.toLowerCase()
    if (!subsequence(lower, q)) continue
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    const score = base.includes(q) ? 0 : subsequence(base, q) ? 1 : 2
    scored.push({ file, score })
  }
  scored.sort((a, b) => a.score - b.score || a.file.length - b.file.length)
  return scored.slice(0, limit).map((s) => s.file)
}

/** The draft after choosing `path` for `mention`, and where the caret goes. */
export function applyMention(
  draft: string,
  mention: Mention,
  path: string
): { draft: string; caret: number } {
  const rest = draft.slice(mention.end)
  const inserted = `@${quoteIfNeeded(path)}${/^\s/.test(rest) ? '' : ' '}`
  const next = draft.slice(0, mention.start) + inserted + rest
  return { draft: next, caret: mention.start + inserted.length }
}

function quoteIfNeeded(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * How a dropped file is written into the draft.
 *
 * Relative when it is inside the workspace, since that is how the agent's
 * own tools report paths; absolute otherwise. A sibling directory sharing a
 * prefix (`app2` beside `app`) is outside — the check is on a separator.
 */
export function mentionFor(absolutePath: string, workspacePath: string): string {
  const file = toPosix(absolutePath)
  const root = toPosix(workspacePath).replace(/\/+$/, '')
  const inside =
    file.toLowerCase().startsWith(root.toLowerCase() + '/') && file.length > root.length + 1
  return `@${quoteIfNeeded(inside ? file.slice(root.length + 1) : file)}`
}
