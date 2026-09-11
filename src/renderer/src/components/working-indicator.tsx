import { useEffect, useState } from 'react'
import type { AgentRuntime } from '@shared/agent-runtime'
import { describeElapsed, workingVerb } from '@/lib/working-indicator'

/**
 * The strip at the base of the chat while the agent works: an amber glyph
 * that pulses, a verb and the elapsed time. The tool in flight is not here:
 * the live row in the transcript names it, and two rows saying the same
 * thing with the same glyph read as one thing twice.
 *
 * Anchored between the transcript and the composer rather than appended to
 * the transcript, so it is on screen whatever the scroll position. The
 * decisions live in `lib/working-indicator.ts`; this owns a clock and
 * nothing else.
 */
export function WorkingIndicator({
  state,
  startedAt
}: {
  state: AgentRuntime['state']
  /** When this turn began; the verb is seeded from it. */
  startedAt: number
}): React.JSX.Element | null {
  const busy = state === 'working' || state === 'starting'

  // One-second ticks while busy: the elapsed label is the only thing here
  // that needs a clock, and a finer tick would re-render for nothing.
  // No synchronous set on the busy edge: the first tick corrects the label
  // within a second, and a set inside the effect would cascade renders.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])

  if (!busy) return null

  const elapsed = Math.max(0, now - startedAt)
  // Spawning the CLI is not the model thinking, and reads better as itself.
  const verb = state === 'starting' ? 'Waking up' : workingVerb(startedAt, elapsed)

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
    >
      <span aria-hidden className="working-glyph text-amber-500">
        ✻
      </span>
      <span className="text-foreground">{verb}…</span>
      <span className="tabular-nums">{describeElapsed(elapsed)}</span>
    </div>
  )
}
