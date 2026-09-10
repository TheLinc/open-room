import { cn } from '@/lib/utils'

type Page<Id extends string> = {
  id: Id
  label: string
  /** Marks the page, for a validation error the user cannot see from here. */
  flagged?: boolean
}

/**
 * The left rail of a paged dialog.
 *
 * Shared by the settings dialog and the agent editor so the two feel like one
 * app: same width, same active treatment, same flag dot. Plain buttons rather
 * than Radix Tabs because the content area is a scroll container the pages
 * swap inside, not a set of panels that each own their layout.
 */
export function DialogNav<Id extends string>({
  label,
  pages,
  active,
  onSelect
}: {
  label: string
  pages: Page<Id>[]
  active: Id
  onSelect: (id: Id) => void
}): React.JSX.Element {
  return (
    <nav
      aria-label={label}
      className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border pr-2"
    >
      {pages.map((page) => {
        const isActive = page.id === active
        return (
          <button
            key={page.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(page.id)}
            className={cn(
              'flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <span>{page.label}</span>
            {page.flagged && (
              <span
                aria-label="has a problem"
                className="size-1.5 shrink-0 rounded-full bg-destructive"
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
