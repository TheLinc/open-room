import { Gauge } from 'lucide-react'
import type { ContextUsage } from '@shared/context-usage'
import { contextSeverity, describeContext } from '@shared/context-usage'
import { cn } from '@/lib/utils'

/**
 * How full the conversation's window is, in the pane header.
 *
 * Open Room resumes conversations over days, so a window filling up is
 * ordinary rather than exceptional — and the only signal used to be an agent
 * quietly getting worse. Silent below the warning threshold: a number that is
 * always on screen stops being read, and 19% is not information.
 */
export function ContextMeter({ usage }: { usage: ContextUsage | null }): React.JSX.Element | null {
  const severity = contextSeverity(usage)
  const text = describeContext(usage)
  if (!text || severity === 'ok') return null

  return (
    <span
      role="status"
      title={`${usage?.usedTokens.toLocaleString()} of ${usage?.windowTokens.toLocaleString()} tokens`}
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
