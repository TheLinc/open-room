import { join } from 'path'

/**
 * Where a conversation's git worktree lives and what it is called.
 *
 * Pure. `WorktreeManager` in main runs git against these; nothing here
 * touches the filesystem, so every naming decision is testable on its own.
 *
 * Worktrees live under the app's own home rather than inside the repository,
 * so the user's tooling — tsc, eslint, the `@` picker's walk — never sees a
 * nested copy of the project. The SDK finds their sessions through
 * `git worktree list`, which does not care where a worktree is.
 */

export const WORKTREE_BRANCH_PREFIX = 'open-room/'

/** What is remembered about a conversation's worktree, keyed by session id. */
export type WorktreeRecord = {
  path: string
  branch: string
  /** The commit the branch was created from; the base for "what changed". */
  baseCommit: string
  createdAt: number
}

export type WorktreeMap = Record<string, WorktreeRecord>

/**
 * How a live session relates to its agent's workspace. Shown in the pane
 * header so the user always knows which checkout an agent is editing.
 */
export type Isolation =
  | { kind: 'workspace' }
  | { kind: 'worktree'; path: string; branch: string }
  /** Worktrees were asked for and could not be provided; the reason is shown. */
  | { kind: 'fallback'; reason: string }

/**
 * A short id for a new worktree: base-36 seconds plus two random characters,
 * so two conversations started in the same second still differ. Lowercase
 * and hyphen-free — it becomes both a directory name and part of a branch.
 */
export function worktreeSlug(now = new Date(), random = Math.random): string {
  const time = Math.floor(now.getTime() / 1000).toString(36)
  const salt = Math.floor(random() * 36 * 36)
    .toString(36)
    .padStart(2, '0')
  return `${time}${salt}`
}

export function worktreePlan(input: { root: string; agentId: string; slug: string }): {
  path: string
  branch: string
} {
  return {
    path: join(input.root, input.agentId, input.slug),
    branch: `${WORKTREE_BRANCH_PREFIX}${input.agentId}/${input.slug}`
  }
}
