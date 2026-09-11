import { Gauge, X } from 'lucide-react'
import type { RateLimitStatus } from '@shared/agent-runtime'
import { describeQuota, quotaSeverity } from '@shared/quota'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Account-wide subscription quota.
 *
 * Rendered once for the whole app rather than inside a chat pane. Every agent
 * draws on the same Claude Code login, so quota is a property of the account;
 * showing it per agent meant the warning appeared only on whichever agent's
 * turn happened to carry the event, while an idle agent showed a clean pane
 * and was equally blocked.
 *
 * Silent while the account is fine — `describeQuota` returns null for the
 * routine `allowed` heartbeat the SDK sends every turn — and gone on its own
 * once the window's reset time passes, which main tracks. Dismissing a
 * reached limit collapses it to `QuotaPill` in the title bar rather than
 * removing it: agents are paused, and that has to stay visible somewhere.
 * A warning dismisses outright.
 */
export function QuotaBanner({
  limit,
  onDismiss
}: {
  limit: RateLimitStatus | null
  onDismiss: () => void
}): React.JSX.Element | null {
  const text = describeQuota(limit)
  if (!text) return null

  const reached = quotaSeverity(limit) === 'reached'

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 border-b px-6 py-2 text-xs',
        reached
          ? 'border-red-500/25 bg-red-500/5 text-red-400'
          : 'border-amber-500/20 bg-amber-500/5 text-amber-500'
      )}
    >
      <Gauge className="size-3.5 shrink-0" />
      <span className="flex-1">{text}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label={reached ? 'Collapse' : 'Dismiss'}
        title={reached ? 'Collapse to the title bar' : 'Dismiss'}
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

/**
 * The collapsed form of a reached limit: a small red gauge in the title bar
 * that restores the banner when clicked. Only a reached limit collapses; a
 * warning is simply dismissed.
 */
export function QuotaPill({
  limit,
  onExpand
}: {
  limit: RateLimitStatus | null
  onExpand: () => void
}): React.JSX.Element | null {
  const text = describeQuota(limit)
  if (!text || quotaSeverity(limit) !== 'reached') return null

  return (
    <button
      type="button"
      onClick={onExpand}
      title={text}
      aria-label={`${text}. Show the banner.`}
      // Inside the drag strip, so it has to opt out or a click drags the window.
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="flex cursor-pointer items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/20"
    >
      <Gauge className="size-3" />
      Limit reached
    </button>
  )
}
