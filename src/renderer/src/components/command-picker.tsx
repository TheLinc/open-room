import { Terminal } from 'lucide-react'
import type { SlashCommandInfo } from '@shared/slash-commands'
import { cn } from '@/lib/utils'

type Props = {
  commands: SlashCommandInfo[]
  selected: number
  onPick: (command: SlashCommandInfo) => void
  onHover: (index: number) => void
}

/**
 * The list that opens above the input while a draft is a bare `/query`.
 *
 * Keyboard handling lives with the textarea, which owns focus; this only
 * draws the rows and reports clicks and hovers.
 */
export function CommandPicker({ commands, selected, onPick, onHover }: Props): React.JSX.Element {
  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="absolute right-0 bottom-full left-0 z-50 mb-1 flex max-h-72 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
    >
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1">
        {commands.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">No matching command.</p>
        )}
        {commands.map((command, i) => (
          <button
            key={command.name}
            type="button"
            role="option"
            aria-selected={i === selected}
            // Mouse down rather than click: a click blurs the textarea first,
            // and the picker closes with it before the click arrives.
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(command)
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm',
              i === selected ? 'bg-muted' : 'hover:bg-muted/60'
            )}
          >
            <Terminal className="size-3.5 shrink-0 self-center text-muted-foreground" />
            <span className="shrink-0 font-mono text-xs">/{command.name}</span>
            {command.argumentHint && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
                {command.argumentHint}
              </span>
            )}
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {command.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
