import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import type { RateLimitStatus } from '@shared/agent-runtime'
import { describeQuota, quotaSeverity } from '@shared/quota'
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
 * routine `allowed` heartbeat the SDK sends every turn.
 */
export function QuotaBanner(): React.JSX.Element | null {
  const [limit, setLimit] = useState<RateLimitStatus | null>(null)

  useEffect(() => {
    // Pulled as well as pushed: the event arrives with an agent's turn, so a
    // window opened afterwards would show nothing until the next one ran.
    void window.openRoom.getQuota().then(setLimit)
    return window.openRoom.onQuotaChanged(setLimit)
  }, [])

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
      <span>{text}</span>
    </div>
  )
}
