import { describe, expect, it } from 'vitest'
import { fileDiff, pathWithin, type DiffGit } from './file-diff'
import { MAX_DIFF_BYTES } from './git'

/**
 * Which git command a row's diff runs, and what comes back. The executor is
 * faked; `git.test.ts` proves the argv against the real binary.
 */

const EDIT = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-one\n+two\n'

function fake(tracked: boolean, out = EDIT): { git: DiffGit; calls: string[] } {
  const calls: string[] = []
  const git: DiffGit = {
    async isTracked(_cwd, path) {
      calls.push(`tracked ${path}`)
      return tracked
    },
    async diffFile(_cwd, base, path) {
      calls.push(`diff ${base} ${path}`)
      return out
    },
    async diffUntracked(_cwd, path) {
      calls.push(`untracked ${path}`)
      return out
    }
  }
  return { git, calls }
}

describe('pathWithin', () => {
  // The style is explicit so both spellings run on every CI platform — the
  // win32 case only ever ran on Windows while it read the platform module.
  it('makes an absolute path inside the checkout relative, posix-style', () => {
    expect(pathWithin('C:\\wt\\x', 'C:\\wt\\x\\src\\a.ts', 'win32')).toBe('src/a.ts')
    expect(pathWithin('/wt/x', '/wt/x/src/a.ts', 'posix')).toBe('src/a.ts')
  })

  it('keeps a relative path relative to the checkout', () => {
    expect(pathWithin('/wt/x', 'src/a.ts', 'posix')).toBe('src/a.ts')
  })

  it('refuses paths that leave the checkout, and the checkout itself', () => {
    expect(pathWithin('/wt/x', '/wt/y/a.ts', 'posix')).toBeNull()
    expect(pathWithin('/wt/x', '../y/a.ts', 'posix')).toBeNull()
    expect(pathWithin('/wt/x', '/wt/x', 'posix')).toBeNull()
  })

  it('resolves a posix checkout the same on any host, WSL-style', () => {
    expect(pathWithin('/home/u/proj', '/home/u/proj/src/a.ts', 'posix')).toBe('src/a.ts')
    expect(pathWithin('/home/u/proj', '/home/u/other/a.ts', 'posix')).toBeNull()
  })
})

describe('fileDiff', () => {
  it('diffs a tracked file against HEAD in the workspace', async () => {
    const { git, calls } = fake(true)
    const result = await fileDiff(git, '/ws', { kind: 'head' }, '/ws/a.ts', 'posix')
    expect(calls).toEqual(['tracked a.ts', 'diff HEAD a.ts'])
    expect(result).toEqual({
      ok: true,
      base: 'head',
      diff: EDIT,
      binary: false,
      tooLarge: false,
      empty: false
    })
  })

  it('diffs against the recorded base commit for a worktree conversation', async () => {
    const { git, calls } = fake(true)
    await fileDiff(git, '/wt/x', { kind: 'branch-base', commit: 'abc123' }, 'a.ts', 'posix')
    expect(calls).toEqual(['tracked a.ts', 'diff abc123 a.ts'])
  })

  it('shows an untracked file as all additions via --no-index', async () => {
    const { git, calls } = fake(false)
    const result = await fileDiff(git, '/ws', { kind: 'head' }, 'new.ts', 'posix')
    expect(calls).toEqual(['tracked new.ts', 'untracked new.ts'])
    expect(result.ok).toBe(true)
  })

  it('reports an oversized diff instead of shipping it to the renderer', async () => {
    const { git } = fake(true, 'x'.repeat(MAX_DIFF_BYTES + 1))
    const result = await fileDiff(git, '/ws', { kind: 'head' }, 'big.ts', 'posix')
    expect(result).toMatchObject({ ok: true, tooLarge: true, diff: '' })
  })

  it('reports a binary file', async () => {
    const { git } = fake(
      true,
      'diff --git a/l.png b/l.png\nBinary files a/l.png and b/l.png differ\n'
    )
    const result = await fileDiff(git, '/ws', { kind: 'head' }, 'l.png', 'posix')
    expect(result).toMatchObject({ ok: true, binary: true })
  })

  it('says when there is nothing to show', async () => {
    const { git } = fake(true, '')
    expect(await fileDiff(git, '/ws', { kind: 'head' }, 'a.ts', 'posix')).toMatchObject({
      ok: true,
      empty: true
    })
  })

  it('refuses a path outside the checkout without running git', async () => {
    const { git, calls } = fake(true)
    const result = await fileDiff(git, '/ws', { kind: 'head' }, '/etc/passwd', 'posix')
    expect(result).toEqual({ ok: false, message: expect.stringContaining('outside') })
    expect(calls).toEqual([])
  })

  it('fails plainly when git is unavailable', async () => {
    expect(await fileDiff(null, '/ws', { kind: 'head' }, 'a.ts', 'posix')).toEqual({
      ok: false,
      message: expect.stringContaining('Git was not found')
    })
  })
})
