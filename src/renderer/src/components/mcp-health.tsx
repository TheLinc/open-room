import { useState } from 'react'
import { ChevronDown, Plug } from 'lucide-react'
import { summarizeMcp, type McpServerHealth, type McpStatus } from '@shared/mcp-health'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const STATUS_LABEL: Record<McpStatus, string> = {
  connected: 'Connected',
  failed: 'Failed',
  'needs-auth': 'Needs auth',
  pending: 'Pending',
  disabled: 'Disabled'
}

const STATUS_CLASS: Record<McpStatus, string> = {
  connected: 'bg-emerald-500',
  failed: 'bg-destructive',
  'needs-auth': 'bg-amber-500',
  pending: 'bg-amber-500',
  disabled: 'bg-muted-foreground/40'
}

/**
 * MCP server health for the running session.
 *
 * Nothing is drawn while every server is connected — that is the common
 * case and should cost no pixels. A failure or an auth prompt gets a pill
 * that opens the full list with the error text, so "the agent cannot see my
 * tools" has an answer somewhere other than the CLI.
 */
export function McpHealth({ servers }: { servers: McpServerHealth[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const summary = summarizeMcp(servers)
  if (summary.severity === 'ok') return null

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'gap-1.5 font-normal',
          summary.severity === 'error' ? 'text-destructive' : 'text-amber-500'
        )}
      >
        <Plug className="size-3.5" />
        <span>{summary.label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 z-50 mt-1 flex w-96 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            <div className="border-b border-border px-3 py-2.5">
              <p className="text-sm font-medium">MCP servers</p>
              <p className="text-xs text-muted-foreground">
                As reported by the session. Fix the server in the agent&apos;s settings, then stop
                and restart the agent.
              </p>
            </div>
            <ul className="flex max-h-80 flex-col overflow-x-hidden overflow-y-auto py-1">
              {servers.map((server) => (
                <li key={server.name} className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden
                      className={cn('size-2 shrink-0 rounded-full', STATUS_CLASS[server.status])}
                    />
                    <span className="min-w-0 truncate font-mono text-xs">{server.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {STATUS_LABEL[server.status]}
                      {server.toolCount !== undefined && ` · ${server.toolCount} tools`}
                      {server.scope && ` · ${server.scope}`}
                    </span>
                  </div>
                  {server.error && (
                    <p className="pl-4 font-mono text-[11px] break-words text-destructive">
                      {server.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
