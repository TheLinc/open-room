import type { RateLimitStatus } from './agent-runtime'

/**
 * Subscription quota, and how to talk about it.
 *
 * Quota belongs to the Claude Code login, not to any one agent — every agent
 * draws on the same subscription, which is the app's premise. It is therefore
 * account state that happens to be *reported* per agent, and the UI has to
 * present it that way: a banner inside one chat pane told you the account was
 * exhausted only if you happened to be looking at the agent whose turn
 * carried the event, while an idle agent showed a clean pane and was equally
 * blocked.
 */

export type QuotaSeverity = 'none' | 'warning' | 'reached'

export function quotaSeverity(limit: RateLimitStatus | null): QuotaSeverity {
  if (!limit) return 'none'
  if (limit.status === 'rejected') return 'reached'
  if (limit.status === 'allowed_warning') return 'warning'
  return 'none'
}

/** Which window was hit, in the user's words rather than the API's. */
function windowName(limit: RateLimitStatus): string {
  if (limit.rateLimitType === 'five_hour') return '5-hour limit'
  if (limit.rateLimitType?.startsWith('seven_day')) return 'weekly limit'
  return 'usage limit'
}

function resetSuffix(limit: RateLimitStatus): string {
  if (!limit.resetsAt) return ''
  const at = new Date(limit.resetsAt * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  return ` · resets ${at}`
}

/**
 * Whether overage is known to be unavailable.
 *
 * This is the difference between "still working, billing differently" and
 * "stopped until the window resets", and the two used to read identically.
 *
 * Positive knowledge only: an absent `overageStatus` means the payload did
 * not say, and the copy must not invent it. Telling someone their agents are
 * paused when they may simply be rolling onto overage is a worse error than
 * saying less.
 */
export function overageBlocked(limit: RateLimitStatus): boolean {
  if (limit.isUsingOverage) return false
  return limit.overageStatus === 'rejected'
}

/**
 * Human-readable quota line, or null when there is nothing worth saying.
 *
 * Silent while `allowed`: a banner that is always on screen stops being read.
 */
export function describeQuota(limit: RateLimitStatus | null): string | null {
  if (!limit || quotaSeverity(limit) === 'none') return null

  const where = windowName(limit)
  const resets = resetSuffix(limit)

  if (limit.status === 'rejected') {
    if (limit.isUsingOverage) return `${where} reached — running on overage${resets}`
    if (overageBlocked(limit)) {
      return `${where} reached — overage is off, so agents are paused${resets}`
    }
    return `${where} reached${resets}`
  }

  // `utilization` is documented by the SDK but absent from observed payloads,
  // so the percentage renders only when one genuinely arrives rather than as
  // an empty pair of brackets.
  const pct =
    typeof limit.utilization === 'number' ? ` (${Math.round(limit.utilization * 100)}%)` : ''
  return `Approaching ${where}${pct}${resets}`
}

/**
 * Whether a change in quota deserves a native notification.
 *
 * Only on the step up, and only once per step. Agents stall in the background
 * by design — the main window is usually hidden — so without this the first
 * sign of an exhausted account is noticing that nothing has happened for a
 * while. Repeating it on every turn would be worse than silence.
 */
export function shouldNotifyQuota(
  previous: RateLimitStatus | null,
  next: RateLimitStatus | null
): boolean {
  const before = quotaSeverity(previous)
  const after = quotaSeverity(next)
  if (after === 'none' || after === before) return false
  return before === 'none' || after === 'reached'
}
