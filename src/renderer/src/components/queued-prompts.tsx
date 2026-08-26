import { Clock, Image, X } from 'lucide-react'
import type { QueuedPromptSummary } from '@shared/prompt-queue'
import { Button } from '@/components/ui/button'

type Props = { agentId: string; queued: QueuedPromptSummary[] }

/** Prompts waiting for the current turn. Shown so "did that send?" has an answer. */
export function QueuedPrompts({ agentId, queued }: Props): React.JSX.Element | null {
  if (queued.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {queued.map((prompt) => (
        <li
          key={prompt.id}
          className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1 text-xs"
        >
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Queued" />
          <span className="min-w-0 flex-1 truncate">{prompt.text || '(images only)'}</span>
          {prompt.imageCount > 0 && (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <Image className="size-3" /> {prompt.imageCount}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            aria-label="Remove from queue"
            onClick={() => void window.openRoom.dropQueuedPrompt(agentId, prompt.id)}
          >
            <X className="size-3" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
