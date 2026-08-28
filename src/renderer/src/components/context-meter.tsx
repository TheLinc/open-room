import { Gauge } from 'lucide-react'
import type { AutoCompact, ContextUsage } from '@shared/context-usage'
import { compactAnchor, contextSeverity, describeContext } from '@shared/context-usage'
import { cn } from '@/lib/utils'

/**
 * How full the conversation's window is, in the pane header.
 *
 * Open Room resumes conversations over days, so a window filling up is
 * ordinary rather than exceptional — and the only signal used to be an agent
 * quietly getting worse. Silent below the warning threshold: a number that is
 * always on screen stops being read, and 19% is not information.
 *
 * The warning bands anchor to the session's real auto-compact point when it
 * has been reported; see `contextSeverity`.
 */
export function ContextMeter({
  usage,
  autoCompact
}: {
  usage: ContextUsage | null
  autoCompact: AutoCompact | null
}): React.JSX.Element | null {
  const severity = contextSeverity(usage, autoCompact)
  const text = describeContext(usage)
  if (!text || severity === 'ok') return null

  const anchor = usage ? compactAnchor(usage, autoCompact) : null
  const compactsAt =
    anchor !== null && autoCompact?.enabled
      ? ` · auto-compacts at ${Math.round(anchor * 100)}%`
      : ''

  return (
    <span
      role="status"
      title={`${usage?.usedTokens.toLocaleString()} of ${usage?.windowTokens.toLocaleString()} tokens${compactsAt}`}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs',
        severity === 'high' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-500'
      )}
    >
      <Gauge className="size-3.5 shrink-0" />
      {text}
    </span>
  )
}
