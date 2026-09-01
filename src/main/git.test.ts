import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findGit, Git, spawnGit, type GitResult, type GitRunner } from './git'

/**
 * Two layers. The argv each operation produces is asserted exactly, because
 * an option that drifts — a `--force` that appears, a `--` that vanishes —
 * changes what git does to the user's checkout without anything else
 * noticing. One case then runs the real binary, since argv that git rejects
 * would pass every recording test.
 */

function recording(reply: Partial<GitResult> = {}): {
  git: Git
  calls: { args: string[]; cwd: string }[]
} {
  const calls: { args: string[]; cwd: string }[] = []
  const run: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd })
    return { code: 0, stdout: '', stderr: '', ...reply }
  }
  return { git: new Git(run), calls }
}

describe('Git argv', () => {
  it('creates a worktree on a new branch from the base commit, path after --', async () => {
    const { git, calls } = recording()
    await git.addWorktree('/repo', '/wt/x', 'open-room/atlas/x', 'abc123')
    expect(calls).toEqual([
      {
        args: ['worktree', 'add', '-b', 'open-room/atlas/x', '--', '/wt/x', 'abc123'],
        cwd: '/repo'
      }
    ])
  })

  it('removes a worktree without --force, so a dirty one is refused', async () => {
    const { git, calls } = recording()
    await git.removeWorktree('/repo', '/wt/x')
    expect(calls[0].args).toEqual(['worktree', 'remove', '--', '/wt/x'])
    expect(calls[0].args).not.toContain('--force')
  })

  it('reports a refused removal with git’s own reason', async () => {
    const { git } = recording({
      code: 128,
      stderr: "fatal: '/wt/x' contains modified or untracked files, use --force to delete it"
    })
    const result = await git.removeWorktree('/repo', '/wt/x')
    expect(result).toEqual({ ok: false, message: expect.stringContaining('modified or untracked') })
  })

  it('deletes a branch with -d, never -D', async () => {
    const { git, calls } = recording()
    await git.deleteBranchIfMerged('/repo', 'open-room/atlas/x')
    expect(calls[0].args).toEqual(['branch', '-d', '--', 'open-room/atlas/x'])
  })

  it('diffs one file against a base with colour and external diff off', async () => {
    const { git, calls } = recording({ stdout: 'diff --git a/f b/f\n' })
    const out = await git.diffFile('/wt/x', 'abc123', 'src/f.ts')
    expect(calls[0].args).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      'abc123',
      '--',
      'src/f.ts'
    ])
    expect(out).toBe('diff --git a/f b/f\n')
  })

  it('treats exit 1 from --no-index as the expected "differs" outcome', async () => {
    const { git } = recording({ code: 1, stdout: 'diff --git a/dev/null b/new.ts\n' })
    await expect(git.diffUntracked('/wt/x', 'new.ts')).resolves.toContain('new.ts')
  })

  it('keeps a path that looks like an option behind --', async () => {
    const { git, calls } = recording()
    await git.isTracked('/repo', '--output=/etc/passwd')
    expect(calls[0].args).toEqual(['ls-files', '--error-unmatch', '--', '--output=/etc/passwd'])
  })
})

const gitPath = findGit()

describe.skipIf(!gitPath)('Git against a real repository', () => {
  it('creates, diffs, refuses to remove a dirty worktree, then removes a clean one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-room-git-'))
    const repo = join(root, 'repo')
    const run = spawnGit(gitPath!)
    const git = new Git(run)
    try {
      await run(['init', '-q', '-b', 'main', repo], root)
      await run(['config', 'user.email', 't@example.com'], repo)
      await run(['config', 'user.name', 'Test'], repo)
      await writeFile(join(repo, 'a.txt'), 'one\n')
      await run(['add', '.'], repo)
      await run(['commit', '-q', '-m', 'init'], repo)

      expect(await git.isRepo(repo)).toBe(true)
      expect(await git.isRepo(root)).toBe(false)
      const base = await git.head(repo)
      expect(base).toMatch(/^[0-9a-f]{40}$/)

      const wt = join(root, 'wt')
      await git.addWorktree(repo, wt, 'open-room/atlas/t1', base!)
      expect(await git.branchExists(repo, 'open-room/atlas/t1')).toBe(true)

      // Edit a tracked file and add a new one in the worktree.
      await writeFile(join(wt, 'a.txt'), 'two\n')
      await writeFile(join(wt, 'b.txt'), 'new\n')
      expect(await git.isTracked(wt, 'a.txt')).toBe(true)
      expect(await git.isTracked(wt, 'b.txt')).toBe(false)
      expect(await git.diffFile(wt, base!, 'a.txt')).toContain('-one')
      expect(await git.diffUntracked(wt, 'b.txt')).toContain('+new')

      // Dirty: refused, and the worktree survives.
      const refused = await git.removeWorktree(repo, wt)
      expect(refused.ok).toBe(false)
      expect(await git.isRepo(wt)).toBe(true)

      // Clean it up and try again.
      await run(['checkout', '--', 'a.txt'], wt)
      await rm(join(wt, 'b.txt'))
      expect(await git.removeWorktree(repo, wt)).toEqual({ ok: true })
      // Nothing was committed on the branch, so it is merged and goes too.
      expect(await git.deleteBranchIfMerged(repo, 'open-room/atlas/t1')).toBe(true)
      expect(await git.branchExists(repo, 'open-room/atlas/t1')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
