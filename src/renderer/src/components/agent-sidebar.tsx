import { AlertTriangle, Plus } from 'lucide-react'
import { AGENT_COLORS, type Agent } from '@shared/agent'
import type { AgentLoadError } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

type Props = {
  agents: Agent[]
  errors: AgentLoadError[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

function colorHex(id: string): string {
  return AGENT_COLORS.find((c) => c.id === id)?.hex ?? '#71717a'
}

export function AgentSidebar({
  agents,
  errors,
  selectedId,
  onSelect,
  onCreate
}: Props): React.JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Open Room</h1>
        <Button size="icon-sm" variant="ghost" onClick={onCreate} aria-label="New agent">
          <Plus />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {agents.map((agent) => (
            <button
              key={agent.config.id}
              type="button"
              onClick={() => onSelect(agent.config.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors',
                selectedId === agent.config.id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorHex(agent.config.color) }}
              />
              <span className="truncate">{agent.config.name}</span>
            </button>
          ))}

          {/* Agents whose files failed to load are shown rather than hidden —
              a vanished agent is far more confusing than a broken one. */}
          {errors.map((error) => (
            <div
              key={error.id}
              className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-2"
            >
              <span className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span className="truncate font-mono">{error.id}</span>
              </span>
              <span className="text-xs text-muted-foreground">{error.message}</span>
            </div>
          ))}
        </div>
      </ScrollArea>

      {agents.length === 0 && errors.length === 0 && (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          No agents yet. Create one to get started.
        </p>
      )}
    </aside>
  )
}
