/**
 * A parser for `git diff` output, so the pane can show what a turn changed
 * without pulling in a diff library.
 *
 * The input is whatever git printed and nothing is reformatted: the pane
 * draws exactly the lines git produced, with the old and new line numbers
 * worked out from each hunk header. Tolerant by design — a rename, a binary
 * notice, a missing trailing newline, or no output at all are all inputs.
 */

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta'

export type DiffLine = {
  kind: DiffLineKind
  /** The line without its leading marker character. */
  text: string
  oldNo: number | null
  newNo: number | null
}

export type DiffHunk = {
  /** The `@@ … @@` line verbatim, including any function context git appended. */
  header: string
  lines: DiffLine[]
}

export type DiffFile = {
  /** Null for a file that did not exist before (`--- /dev/null`). */
  oldPath: string | null
  /** Null for a file that no longer exists. */
  newPath: string | null
  binary: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export type UnifiedDiff = { files: DiffFile[] }

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function pathOf(marker: string): string | null {
  // `--- a/path` / `+++ b/path`, or `/dev/null`. A tab and metadata may follow
  // the path in some git configurations; only the path is wanted.
  const raw = marker.slice(4).split('\t')[0]
  if (raw === '/dev/null') return null
  return raw.replace(/^[ab]\//, '')
}

export function parseUnifiedDiff(text: string): UnifiedDiff {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { oldPath: null, newPath: null, binary: false, hunks: [], additions: 0, deletions: 0 }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue

    // Inside a hunk, a line starting with `---` or `+++` is content — a
    // removed SQL comment, say — so the file headers are only read between
    // hunks. Everything else before the first hunk is git metadata.
    if (!hunk) {
      if (line.startsWith('--- ')) file.oldPath = pathOf(line)
      else if (line.startsWith('+++ ')) file.newPath = pathOf(line)
      else if (line.startsWith('Binary files ')) file.binary = true
    }

    const header = HUNK_HEADER.exec(line)
    if (header) {
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      oldNo = Number(header[1])
      newNo = Number(header[3])
      continue
    }
    if (!hunk) continue

    if (line.startsWith('\\ ')) {
      hunk.lines.push({ kind: 'meta', text: line.slice(2), oldNo: null, newNo: null })
    } else if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ })
      file.additions += 1
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null })
      file.deletions += 1
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    } else if (line === '') {
      // A blank context line arrives as a bare empty string in some outputs;
      // a trailing empty string is just the final newline.
      continue
    }
  }

  return { files }
}
