import { posix, win32 } from 'node:path'
import type { FileDiffResult } from '@shared/ipc'
import { parseUnifiedDiff } from '@shared/unified-diff'
import { MAX_DIFF_BYTES, type Git } from './git'

/**
 * The diff behind a row in "Files changed".
 *
 * Read-only by design: Open Room is a delegation surface beside the user's
 * editor, and accepting or reverting hunks is the editor's job. What this
 * answers is "what did the agent do to this file", against the base the
 * conversation started from — the recorded base commit for a worktree
 * conversation (so committed work shows too), `HEAD` in the workspace.
 *
 * It is the file's *current* state against that base, not a snapshot at the
 * end of the turn: later turns or the user's own edits are included, and the
 * label in the pane says so.
 */

export type DiffGit = Pick<Git, 'isTracked' | 'diffFile' | 'diffUntracked'>

/**
 * Resolves the agent's path into `cwd`, refusing anything that escapes it.
 *
 * The path comes from the agent's own Edit/Write tool input and is usually
 * absolute already; a relative one is taken against the conversation's cwd.
 * Anything outside the checkout is refused rather than diffed — git would
 * only refuse it anyway, and the refusal here says why.
 *
 * The style is a parameter, not `process.platform`: the checkout decides
 * how its paths are spelled — a WSL agent's is posix on a Windows host —
 * and the platform module would make the Windows case untestable on the
 * macOS CI leg (where it silently was, until that leg ran).
 */
export function pathWithin(cwd: string, path: string, style: 'win32' | 'posix'): string | null {
  const p = style === 'win32' ? win32 : posix
  const absolute = p.isAbsolute(path) ? p.resolve(path) : p.resolve(cwd, path)
  const rel = p.relative(p.resolve(cwd), absolute)
  if (rel === '' || rel.startsWith('..') || p.isAbsolute(rel)) return null
  return rel.split('\\').join('/')
}

export async function fileDiff(
  git: DiffGit | null,
  cwd: string,
  base: { kind: 'head' } | { kind: 'branch-base'; commit: string },
  path: string,
  style: 'win32' | 'posix'
): Promise<FileDiffResult> {
  if (!git) return { ok: false, message: 'Git was not found on PATH.' }

  const rel = pathWithin(cwd, path, style)
  if (!rel) return { ok: false, message: 'That file is outside the conversation’s checkout.' }

  try {
    const tracked = await git.isTracked(cwd, rel)
    const text = tracked
      ? await git.diffFile(cwd, base.kind === 'head' ? 'HEAD' : base.commit, rel)
      : await git.diffUntracked(cwd, rel)

    if (text.length > MAX_DIFF_BYTES) {
      return {
        ok: true,
        base: base.kind,
        diff: '',
        binary: false,
        tooLarge: true,
        empty: false
      }
    }

    const parsed = parseUnifiedDiff(text)
    return {
      ok: true,
      base: base.kind,
      diff: text,
      binary: parsed.files.some((file) => file.binary),
      tooLarge: false,
      empty: text.trim() === ''
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'git diff failed' }
  }
}
