import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Agent } from '@shared/agent'
import {
  worktreePlan,
  worktreeSlug,
  type Isolation,
  type WorktreeMap,
  type WorktreeRecord
} from '@shared/worktrees'
import type { Git } from './git'

/**
 * Gives each new conversation of a worktree-enabled agent its own git
 * worktree, and remembers which conversation owns which.
 *
 * The record is keyed by session id and lives beside the agent's config in
 * `worktrees.json`. A session id is only known once the CLI's init message
 * arrives, so a worktree is created *pending* and committed to the record
 * when the session identifies itself — or abandoned if it never does.
 *
 * Two promises this keeps, whatever else goes wrong: the agent is never
 * silently run somewhere other than where the pane says (`Isolation` is
 * always reported), and nothing uncommitted or unmerged is ever deleted.
 */

export const WORKTREES_FILE = 'worktrees.json'

export type Placement = {
  cwd: string
  isolation: Isolation
  /** A worktree created for this start, awaiting the session id to record it. */
  pending: WorktreeRecord | null
}

/** The slice of `Git` this needs; tests supply an in-memory one. */
export type WorktreeGit = Pick<
  Git,
  | 'isRepo'
  | 'head'
  | 'addWorktree'
  | 'attachWorktree'
  | 'branchExists'
  | 'removeWorktree'
  | 'deleteBranchIfMerged'
>

const IN_WORKSPACE: Placement = { cwd: '', isolation: { kind: 'workspace' }, pending: null }

export class WorktreeManager {
  constructor(
    /** Where worktrees are created: `<OPEN_ROOM_HOME>/worktrees`. */
    private readonly root: string,
    /** The agent's own directory, where `worktrees.json` lives. */
    private readonly agentDir: (agentId: string) => string,
    /** Null when git is not on PATH; every worktree agent then falls back. */
    private readonly git: WorktreeGit | null,
    private readonly now: () => number = () => Date.now(),
    private readonly slug: () => string = () => worktreeSlug()
  ) {}

  async records(agentId: string): Promise<WorktreeMap> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file(agentId), 'utf8'))
      return isMap(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  async recordFor(agentId: string, sessionId: string): Promise<WorktreeRecord | null> {
    return (await this.records(agentId))[sessionId] ?? null
  }

  /**
   * Where a session about to start should run.
   *
   * Resuming follows the record for that conversation; a conversation from
   * before the feature has none and stays in the workspace. A new
   * conversation gets a fresh worktree if the agent asks for one and the
   * workspace can provide it, and otherwise says why not.
   */
  async place(agent: Agent, resumeSessionId: string | null): Promise<Placement> {
    const workspace = agent.config.workspacePath
    const inWorkspace = { ...IN_WORKSPACE, cwd: workspace }

    if (resumeSessionId) {
      const record = await this.recordFor(agent.config.id, resumeSessionId)
      if (!record) return inWorkspace
      return this.reopen(workspace, record)
    }

    if (!agent.config.worktrees) return inWorkspace
    if (!this.git) return fallback(workspace, 'Git was not found on PATH')

    try {
      if (!(await this.git.isRepo(workspace))) {
        return fallback(workspace, 'The workspace is not a git repository')
      }
      const base = await this.git.head(workspace)
      if (!base) return fallback(workspace, 'The repository has no commits yet')

      const plan = worktreePlan({ root: this.root, agentId: agent.config.id, slug: this.slug() })
      await mkdir(dirname(plan.path), { recursive: true })
      await this.git.addWorktree(workspace, plan.path, plan.branch, base)

      const record: WorktreeRecord = { ...plan, baseCommit: base, createdAt: this.now() }
      return {
        cwd: plan.path,
        isolation: { kind: 'worktree', path: plan.path, branch: plan.branch },
        pending: record
      }
    } catch (error) {
      return fallback(workspace, error instanceof Error ? error.message : 'git failed')
    }
  }

  /** A worktree the record knows about, re-attached if its directory is gone. */
  private async reopen(workspace: string, record: WorktreeRecord): Promise<Placement> {
    const present = await stat(record.path)
      .then((info) => info.isDirectory())
      .catch(() => false)
    const isolation: Isolation = { kind: 'worktree', path: record.path, branch: record.branch }

    if (present) return { cwd: record.path, isolation, pending: null }

    // The directory went away — a manual `git worktree prune`, a cleared temp
    // folder — but the branch holds the work. Put the worktree back.
    if (this.git && (await this.git.branchExists(workspace, record.branch))) {
      try {
        await mkdir(dirname(record.path), { recursive: true })
        await this.git.attachWorktree(workspace, record.path, record.branch)
        return { cwd: record.path, isolation, pending: null }
      } catch (error) {
        return fallback(workspace, error instanceof Error ? error.message : 'git failed')
      }
    }

    return fallback(
      workspace,
      `This conversation's worktree (${record.branch}) no longer exists; running in the workspace`
    )
  }

  /** The session identified itself: the pending worktree is now its own. */
  async commit(agentId: string, sessionId: string, record: WorktreeRecord): Promise<void> {
    const map = await this.records(agentId)
    map[sessionId] = record
    await this.write(agentId, map)
  }

  /**
   * A worktree whose session never started. Nothing has been written in it,
   * so removing it and its branch loses nothing — and leaving it would strand
   * an unrecorded checkout nobody can find from the app.
   */
  async abandon(agent: Agent, record: WorktreeRecord): Promise<void> {
    if (!this.git) return
    const removed = await this.git.removeWorktree(agent.config.workspacePath, record.path)
    if (removed.ok) await this.git.deleteBranchIfMerged(agent.config.workspacePath, record.branch)
  }

  /**
   * The conversation is being deleted. Its worktree goes only if clean, its
   * branch only if merged; whatever is kept is named in the message so the
   * user knows where their work is.
   */
  async release(agent: Agent, sessionId: string): Promise<{ message: string | null }> {
    const agentId = agent.config.id
    const map = await this.records(agentId)
    const record = map[sessionId]
    if (!record) return { message: null }

    delete map[sessionId]
    await this.write(agentId, map)

    if (!this.git) return { message: `Worktree kept at ${record.path} (git not found)` }

    const removed = await this.git.removeWorktree(agent.config.workspacePath, record.path)
    if (!removed.ok) {
      return { message: `Worktree kept at ${record.path}: ${removed.message}` }
    }
    const branchGone = await this.git.deleteBranchIfMerged(
      agent.config.workspacePath,
      record.branch
    )
    return {
      message: branchGone ? null : `Branch ${record.branch} kept: it has unmerged commits`
    }
  }

  private file(agentId: string): string {
    return join(this.agentDir(agentId), WORKTREES_FILE)
  }

  private async write(agentId: string, map: WorktreeMap): Promise<void> {
    await mkdir(this.agentDir(agentId), { recursive: true })
    await writeFile(this.file(agentId), JSON.stringify(map, null, 2) + '\n')
  }
}

function fallback(workspace: string, reason: string): Placement {
  return { cwd: workspace, isolation: { kind: 'fallback', reason }, pending: null }
}

function isMap(value: unknown): value is WorktreeMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (record) =>
      record &&
      typeof record === 'object' &&
      typeof (record as WorktreeRecord).path === 'string' &&
      typeof (record as WorktreeRecord).branch === 'string' &&
      typeof (record as WorktreeRecord).baseCommit === 'string'
  )
}
