import { X } from 'lucide-react'
import type { Aside } from '@shared/agent-runtime'

/**
 * The most recent side question and its answer.
 *
 * A card above the composer rather than a transcript row: the question was
 * answered from the conversation, not in it, and rendering it among the
 * turns would say otherwise. It goes away on the next prompt or on dismiss.
 */
export function AsideCard({
  aside,
  onDismiss
}: {
  aside: Aside | null
  onDismiss: () => void
}): React.JSX.Element | null {
  if (!aside) return null
  return (
    <div className="mx-4 mb-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span>Side question · not part of the conversation</span>
        <button
          type="button"
          aria-label="Dismiss side question"
          className="rounded p-0.5 hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-1 italic text-muted-foreground">“{aside.question}”</div>
      <div className="mt-1 whitespace-pre-wrap text-foreground">{aside.answer ?? 'Thinking…'}</div>
    </div>
  )
}
