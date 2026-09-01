import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Agent } from '@shared/agent'
import type { WorktreeRecord } from '@shared/worktrees'
import { WorktreeManager, WORKTREES_FILE, type WorktreeGit } from './worktrees'

/**
 * The manager decides where a session runs and what a deleted conversation
 * leaves behind. Git is faked in memory so every branch of those decisions
 * can be driven; the real binary is exercised in `git.test.ts`.
 */

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-room-wt-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function agent(worktrees: boolean): Agent {
  return {
    config: { id: 'atlas', workspacePath: join(root, 'repo'), worktrees },
    context: ''
  } as unknown as Agent
}

/** An in-memory repository: which paths are worktrees, which branches exist, what is dirty. */
class FakeGit implements WorktreeGit {
  repo = true
  headCommit: string | null = 'abc123'
  branches = new Set<string>()
  dirty = new Set<string>()
  unmerged = new Set<string>()
  calls: string[] = []

  async isRepo(): Promise<boolean> {
    return this.repo
  }
  async head(): Promise<string | null> {
    return this.headCommit
  }
  async addWorktree(_repo: string, path: string, branch: string, base: string): Promise<void> {
    this.calls.push(`add ${branch} ${base}`)
    this.branches.add(branch)
    await mkdir(path, { recursive: true })
  }
  async attachWorktree(_repo: string, path: string, branch: string): Promise<void> {
    this.calls.push(`attach ${branch}`)
    await mkdir(path, { recursive: true })
  }
  async branchExists(_repo: string, branch: string): Promise<boolean> {
    return this.branches.has(branch)
  }
  async removeWorktree(
    _repo: string,
    path: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    this.calls.push(`remove ${path}`)
    if (this.dirty.has(path)) return { ok: false, message: 'contains modified or untracked files' }
    await rm(path, { recursive: true, force: true })
    return { ok: true }
  }
  async deleteBranchIfMerged(_repo: string, branch: string): Promise<boolean> {
    this.calls.push(`branch -d ${branch}`)
    if (this.unmerged.has(branch)) return false
    this.branches.delete(branch)
    return true
  }
}

function manager(git: WorktreeGit | null, slug = 'x7k2'): WorktreeManager {
  return new WorktreeManager(
    join(root, 'worktrees'),
    (id) => join(root, 'agents', id),
    git,
    () => 1_756_000_000_000,
    () => slug
  )
}

describe('WorktreeManager.place for a new conversation', () => {
  it('runs in the workspace when the agent has not opted in', async () => {
    const git = new FakeGit()
    const placement = await manager(git).place(agent(false), null)
    expect(placement).toEqual({
      cwd: join(root, 'repo'),
      isolation: { kind: 'workspace' },
      pending: null
    })
    expect(git.calls).toEqual([])
  })

  it('creates a worktree on a branch from HEAD and returns it as pending', async () => {
    const git = new FakeGit()
    const placement = await manager(git).place(agent(true), null)

    const path = join(root, 'worktrees', 'atlas', 'x7k2')
    expect(placement.cwd).toBe(path)
    expect(placement.isolation).toEqual({ kind: 'worktree', path, branch: 'open-room/atlas/x7k2' })
    expect(placement.pending).toEqual({
      path,
      branch: 'open-room/atlas/x7k2',
      baseCommit: 'abc123',
      createdAt: 1_756_000_000_000
    })
    expect(git.calls).toEqual(['add open-room/atlas/x7k2 abc123'])
  })

  it('falls back with a reason when the workspace is not a repository', async () => {
    const git = new FakeGit()
    git.repo = false
    const placement = await manager(git).place(agent(true), null)
    expect(placement.cwd).toBe(join(root, 'repo'))
    expect(placement.isolation).toEqual({
      kind: 'fallback',
      reason: expect.stringContaining('not a git repository')
    })
    expect(placement.pending).toBeNull()
  })

  it('falls back when the repository has no commits', async () => {
    const git = new FakeGit()
    git.headCommit = null
    const placement = await manager(git).place(agent(true), null)
    expect(placement.isolation.kind).toBe('fallback')
  })

  it('falls back when git is not installed', async () => {
    const placement = await manager(null).place(agent(true), null)
    expect(placement.isolation).toEqual({
      kind: 'fallback',
      reason: expect.stringContaining('Git was not found')
    })
  })

  it('falls back with git’s message when creating the worktree fails', async () => {
    const git = new FakeGit()
    git.addWorktree = async () => {
      throw new Error("fatal: 'x' is not a valid branch name")
    }
    const placement = await manager(git).place(agent(true), null)
    expect(placement.isolation).toEqual({
      kind: 'fallback',
      reason: expect.stringContaining('not a valid branch name')
    })
  })
})

describe('WorktreeManager records and resume', () => {
  it('round-trips a committed record through worktrees.json', async () => {
    const git = new FakeGit()
    const m = manager(git)
    const placement = await m.place(agent(true), null)
    await m.commit('atlas', 'session-1', placement.pending!)

    const onDisk = JSON.parse(await readFile(join(root, 'agents', 'atlas', WORKTREES_FILE), 'utf8'))
    expect(onDisk['session-1'].branch).toBe('open-room/atlas/x7k2')
    expect(await m.recordFor('atlas', 'session-1')).toEqual(placement.pending)
  })

  it('resumes a recorded conversation in its worktree without touching git', async () => {
    const git = new FakeGit()
    const m = manager(git)
    const placement = await m.place(agent(true), null)
    await m.commit('atlas', 'session-1', placement.pending!)
    git.calls = []

    const resumed = await m.place(agent(true), 'session-1')
    expect(resumed).toEqual({ cwd: placement.cwd, isolation: placement.isolation, pending: null })
    expect(git.calls).toEqual([])
  })

  it('resumes a conversation with no record in the workspace', async () => {
    // Conversations from before the feature, or from an agent that opted in later.
    const placement = await manager(new FakeGit()).place(agent(true), 'old-session')
    expect(placement).toEqual({
      cwd: join(root, 'repo'),
      isolation: { kind: 'workspace' },
      pending: null
    })
  })

  it('re-attaches the branch when the worktree directory has gone', async () => {
    const git = new FakeGit()
    const m = manager(git)
    const placement = await m.place(agent(true), null)
    await m.commit('atlas', 'session-1', placement.pending!)
    await rm(placement.cwd, { recursive: true })
    git.calls = []

    const resumed = await m.place(agent(true), 'session-1')
    expect(resumed.cwd).toBe(placement.cwd)
    expect(resumed.isolation.kind).toBe('worktree')
    expect(git.calls).toEqual(['attach open-room/atlas/x7k2'])
  })

  it('falls back, naming the branch, when both directory and branch are gone', async () => {
    const git = new FakeGit()
    const m = manager(git)
    const placement = await m.place(agent(true), null)
    await m.commit('atlas', 'session-1', placement.pending!)
    await rm(placement.cwd, { recursive: true })
    git.branches.clear()

    const resumed = await m.place(agent(true), 'session-1')
    expect(resumed.cwd).toBe(join(root, 'repo'))
    expect(resumed.isolation).toEqual({
      kind: 'fallback',
      reason: expect.stringContaining('open-room/atlas/x7k2')
    })
  })

  it('ignores a corrupt records file rather than failing every start', async () => {
    await mkdir(join(root, 'agents', 'atlas'), { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'agents', 'atlas', WORKTREES_FILE), '{ not json')
    expect(await manager(new FakeGit()).records('atlas')).toEqual({})
  })
})

describe('WorktreeManager.release', () => {
  async function recorded(git: FakeGit): Promise<{ m: WorktreeManager; record: WorktreeRecord }> {
    const m = manager(git)
    const placement = await m.place(agent(true), null)
    await m.commit('atlas', 'session-1', placement.pending!)
    git.calls = []
    return { m, record: placement.pending! }
  }

  it('removes a clean worktree, deletes its merged branch, and forgets the record', async () => {
    const git = new FakeGit()
    const { m, record } = await recorded(git)

    expect(await m.release(agent(true), 'session-1')).toEqual({ message: null })
    expect(git.calls).toEqual([`remove ${record.path}`, `branch -d ${record.branch}`])
    expect(await m.recordFor('atlas', 'session-1')).toBeNull()
  })

  it('keeps a dirty worktree and says where it is', async () => {
    const git = new FakeGit()
    const { m, record } = await recorded(git)
    git.dirty.add(record.path)

    const result = await m.release(agent(true), 'session-1')
    expect(result.message).toContain(record.path)
    expect(result.message).toContain('modified or untracked')
    // The branch is never touched while its worktree still exists.
    expect(git.calls).toEqual([`remove ${record.path}`])
  })

  it('keeps an unmerged branch and says so', async () => {
    const git = new FakeGit()
    const { m, record } = await recorded(git)
    git.unmerged.add(record.branch)

    const result = await m.release(agent(true), 'session-1')
    expect(result.message).toContain(record.branch)
    expect(git.branches.has(record.branch)).toBe(true)
  })

  it('is a no-op for a conversation with no worktree', async () => {
    const git = new FakeGit()
    expect(await manager(git).release(agent(true), 'nope')).toEqual({ message: null })
    expect(git.calls).toEqual([])
  })

  it('abandon removes a worktree whose session never started', async () => {
    const git = new FakeGit()
    const m = manager(git)
    const placement = await m.place(agent(true), null)
    git.calls = []

    await m.abandon(agent(true), placement.pending!)
    expect(git.calls).toEqual([`remove ${placement.cwd}`, `branch -d open-room/atlas/x7k2`])
  })
})
