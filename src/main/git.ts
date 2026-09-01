import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolveExecutable } from './open-in-editor'

/**
 * The handful of git operations Open Room performs: worktrees for
 * conversations, and diffs for the files-changed list.
 *
 * Every command is an argument array handed to `spawn` — never a shell — and
 * every user- or agent-supplied path goes after `--`, so a path that looks
 * like an option is still a path. `Git` takes its runner as a dependency: the
 * tests assert the exact argv each operation produces against a recording
 * runner, and one integration case runs the real binary in a temp repo.
 */

export type GitResult = { code: number; stdout: string; stderr: string }
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>

/** Longer than any of these should take; shorter than "the app is hung". */
export const GIT_TIMEOUT_MS = 15_000

/** Diff output past this is reported as too large rather than rendered. */
export const MAX_DIFF_BYTES = 200_000

/** `git` on PATH, resolved the same way the editor command is. */
export function findGit(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync
): string | null {
  return resolveExecutable('git', env, platform, exists)
}

export function spawnGit(gitPath: string): GitRunner {
  return (args, cwd) =>
    new Promise((resolve) => {
      const child = spawn(gitPath, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Diffs are read as text; git prints paths as-is and content as bytes,
        // which is what the pane shows.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))

      const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS)
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ code: -1, stdout, stderr: error.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code: code ?? -1, stdout, stderr })
      })
    })
}

function failure(result: GitResult, fallback: string): string {
  const text = (result.stderr || result.stdout).trim()
  return text || fallback
}

export class Git {
  constructor(private readonly run: GitRunner) {}

  async isRepo(dir: string): Promise<boolean> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree'], dir)
    return result.code === 0 && result.stdout.trim() === 'true'
  }

  /** The current commit, or null on an unborn branch (a repo with no commits). */
  async head(dir: string): Promise<string | null> {
    const result = await this.run(['rev-parse', '--verify', '--quiet', 'HEAD'], dir)
    return result.code === 0 ? result.stdout.trim() : null
  }

  /** Creates `branch` at `base` and checks it out in a new worktree at `path`. */
  async addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
    const result = await this.run(['worktree', 'add', '-b', branch, '--', path, base], repo)
    if (result.code !== 0) throw new Error(failure(result, 'git worktree add failed'))
  }

  /** Re-attaches an existing branch to a new worktree at `path`. */
  async attachWorktree(repo: string, path: string, branch: string): Promise<void> {
    const result = await this.run(['worktree', 'add', '--', path, branch], repo)
    if (result.code !== 0) throw new Error(failure(result, 'git worktree add failed'))
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    const result = await this.run(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      repo
    )
    return result.code === 0
  }

  /**
   * Removes a worktree — and refuses if it has uncommitted changes. Never
   * `--force`: a refusal here is the user's work being protected.
   */
  async removeWorktree(
    repo: string,
    path: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const result = await this.run(['worktree', 'remove', '--', path], repo)
    return result.code === 0
      ? { ok: true }
      : { ok: false, message: failure(result, 'git worktree remove failed') }
  }

  /** `git branch -d`: deletes only a branch that is fully merged. */
  async deleteBranchIfMerged(repo: string, branch: string): Promise<boolean> {
    const result = await this.run(['branch', '-d', '--', branch], repo)
    return result.code === 0
  }

  /** Whether git knows about the file at all. */
  async isTracked(cwd: string, path: string): Promise<boolean> {
    const result = await this.run(['ls-files', '--error-unmatch', '--', path], cwd)
    return result.code === 0
  }

  /**
   * The unified diff of one file against `base` — a commit, or `HEAD` for
   * the uncommitted changes. `--no-color` and `--no-ext-diff` so the output
   * is what the parser expects whatever the user's git config says.
   */
  async diffFile(cwd: string, base: string, path: string): Promise<string> {
    const result = await this.run(['diff', '--no-color', '--no-ext-diff', base, '--', path], cwd)
    if (result.code !== 0) throw new Error(failure(result, 'git diff failed'))
    return result.stdout
  }

  /**
   * A file git does not track yet, shown as all additions. `--no-index`
   * exits 1 when the sides differ, which here is the expected outcome.
   */
  async diffUntracked(cwd: string, path: string): Promise<string> {
    const result = await this.run(
      ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', path],
      cwd
    )
    if (result.code !== 0 && result.code !== 1) throw new Error(failure(result, 'git diff failed'))
    return result.stdout
  }
}
