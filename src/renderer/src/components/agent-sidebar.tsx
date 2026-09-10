import { useState } from 'react'
import {
  AlertTriangle,
  CircleAlert,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2
} from 'lucide-react'
import type { Agent } from '@shared/agent'
import { colorHexFor } from '@shared/agent-colors'
import { isTransient, type AgentRuntime } from '@shared/agent-runtime'
import type { AgentLoadError } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'

type Props = {
  agents: Agent[]
  errors: AgentLoadError[]
  selectedId: string | null
  runtimeFor: (agentId: string) => AgentRuntime
  onSelect: (id: string) => void
  onCreate: () => void
  onOpenSettings: () => void
  /** Opens the editor on this agent. */
  onEdit: (id: string) => void
  /** Deletes this agent; the row has already asked twice. */
  onDelete: (id: string) => void
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

/**
 * The row's menu: the quick way to an agent's settings, without first
 * selecting it and finding Edit in the pane header.
 *
 * Delete asks twice inside the menu. The first click keeps the menu open
 * (`preventDefault` on `onSelect`, which is how Radix lets an item stay) and
 * relabels itself; the second deletes. Closing the menu forgets the first
 * click, so a stray press never arms a delete for later.
 */
function RowMenu({
  agent,
  onEdit,
  onDelete
}: {
  agent: Agent
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)

  return (
    <DropdownMenu onOpenChange={(open) => !open && setConfirming(false)}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`More for ${agent.config.name}`}
          title="More"
          // Revealed on hover and focus, and whenever open. Kept out of the
          // row's own button so a press here never selects the agent.
          className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 group-data-[selected=true]:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit agent
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={(event) => {
            if (!confirming) {
              event.preventDefault()
              setConfirming(true)
              return
            }
            onDelete()
          }}
        >
          <Trash2 />
          {confirming ? 'Click again to delete' : 'Delete agent'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AgentSidebar({
  agents,
  errors,
  selectedId,
  runtimeFor,
  onSelect,
  onCreate,
  onOpenSettings,
  onEdit,
  onDelete
}: Props): React.JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      {/* No heading here: the app name sits directly above in the title bar,
          and stacking the two put "Open Room" on screen twice. */}
      <div className="flex items-center justify-end px-3 py-2">
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
          {agents.map((agent) => {
            const isSelected = selectedId === agent.config.id
            return (
              // A div holding a button and a menu, not one button: a button
              // cannot contain another, and the menu must not select the row.
              <div
                key={agent.config.id}
                data-selected={isSelected}
                className={cn(
                  'group flex items-center gap-1 rounded-md pr-1 text-sm transition-colors',
                  isSelected
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(agent.config.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colorHexFor(agent.config.color) }}
                  />
                  <span className="flex-1 truncate">{agent.config.name}</span>
                  <StatusDot runtime={runtimeFor(agent.config.id)} />
                </button>
                <RowMenu
                  agent={agent}
                  onEdit={() => onEdit(agent.config.id)}
                  onDelete={() => onDelete(agent.config.id)}
                />
              </div>
            )
          })}

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
