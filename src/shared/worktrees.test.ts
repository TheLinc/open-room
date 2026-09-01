import { describe, expect, it } from 'vitest'
import { sep } from 'path'
import { worktreePlan, worktreeSlug, WORKTREE_BRANCH_PREFIX } from './worktrees'

/**
 * Where a conversation's worktree goes and what its branch is called. Pure:
 * the manager in main executes these against git.
 */

describe('worktreeSlug', () => {
  it('is short, lowercase and filesystem-safe', () => {
    const slug = worktreeSlug(new Date('2026-08-31T08:00:00Z'), () => 0.123456)
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(slug.length).toBeLessThanOrEqual(24)
  })

  it('differs across calls even within one second', () => {
    const at = new Date('2026-08-31T08:00:00Z')
    const a = worktreeSlug(at, () => 0.1)
    const b = worktreeSlug(at, () => 0.9)
    expect(a).not.toBe(b)
  })
})

describe('worktreePlan', () => {
  it('places the worktree under the app home and names the branch after the agent', () => {
    const plan = worktreePlan({
      root: '/home/u/.open-room/worktrees',
      agentId: 'atlas',
      slug: 'x7k2'
    })
    expect(plan.path.split(sep).join('/')).toBe('/home/u/.open-room/worktrees/atlas/x7k2')
    expect(plan.branch).toBe(`${WORKTREE_BRANCH_PREFIX}atlas/x7k2`)
  })
})
