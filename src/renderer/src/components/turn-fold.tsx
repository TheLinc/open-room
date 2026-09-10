import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * The row that stands in for a settled turn's activity.
 *
 * Muted, one line, a chevron: it is a summary of work already done, and it
 * should read as quieter than the reply below it. The expanded entries are
 * rendered by the pane, which owns the transcript's row styling; this only
 * draws the toggle.
 */
export function TurnFold({
  label,
  count,
  expanded,
  onToggle
}: {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const Icon = expanded ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      title={expanded ? 'Hide the steps' : `Show ${count} step${count === 1 ? '' : 's'}`}
      className="flex w-fit cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground tabular-nums transition-colors select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none"
    >
      <span>{label}</span>
      <Icon className="size-3.5" />
    </button>
  )
}
