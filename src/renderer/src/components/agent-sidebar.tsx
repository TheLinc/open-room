import { AlertTriangle, CircleAlert, Loader2, Plus, Settings } from 'lucide-react'
import type { Agent } from '@shared/agent'
import { colorHexFor } from '@shared/agent-colors'
import { isTransient, type AgentRuntime } from '@shared/agent-runtime'
import type { AgentLoadError } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

type Props = {
  agents: Agent[]
  errors: AgentLoadError[]
  selectedId: string | null
  runtimeFor: (agentId: string) => AgentRuntime
  onSelect: (id: string) => void
  onCreate: () => void
  onOpenSettings: () => void
}

/**
 * A running agent needs to be visible from the sidebar — the whole point of
 * the app is working while you look at something else. Quota conditions get
 * their own colour, since waiting fixes them and a crash does not.
 */
function StatusDot({ runtime }: { runtime: AgentRuntime }): React.JSX.Element | null {
  if (runtime.state === 'working' || runtime.state === 'starting') {
    return <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
  }
  if (runtime.state === 'error') {
    return (
      <CircleAlert
        className={cn(
          'size-3 shrink-0',
          runtime.error && isTransient(runtime.error.kind) ? 'text-amber-500' : 'text-destructive'
        )}
      />
    )
  }
  if (runtime.state === 'ready') {
    return <span aria-label="ready" className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
  }
  return null
}

export function AgentSidebar({
  agents,
  errors,
  selectedId,
  runtimeFor,
  onSelect,
  onCreate,
  onOpenSettings
}: Props): React.JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Open Room</h1>
        <div className="flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" onClick={onCreate} aria-label="New agent">
            <Plus />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onOpenSettings} aria-label="Settings">
            <Settings />
          </Button>
        </div>
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
                style={{ backgroundColor: colorHexFor(agent.config.color) }}
              />
              <span className="flex-1 truncate">{agent.config.name}</span>
              <StatusDot runtime={runtimeFor(agent.config.id)} />
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
