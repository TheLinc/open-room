import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AppInfo } from '@shared/ipc'

/**
 * Phase 0 smoke screen. Proves the three things this phase exists to prove:
 * Tailwind + shadcn render, the typed IPC bridge round-trips, and the window
 * boots on both platforms. Replaced in Phase 1 by the agent list and editor.
 */
function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.openRoom
      .getAppInfo()
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Open Room</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Run multiple named Claude Code agents concurrently, addressed by voice or chat.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 font-mono text-xs text-card-foreground">
        {error ? (
          <span className="text-destructive">IPC error: {error}</span>
        ) : info ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">app</dt>
            <dd>
              {info.name} {info.version}
            </dd>
            <dt className="text-muted-foreground">electron</dt>
            <dd>{info.electron}</dd>
            <dt className="text-muted-foreground">chrome</dt>
            <dd>{info.chrome}</dd>
            <dt className="text-muted-foreground">node</dt>
            <dd>{info.node}</dd>
            <dt className="text-muted-foreground">platform</dt>
            <dd>{info.platform}</dd>
          </dl>
        ) : (
          <span className="text-muted-foreground">Loading app info over IPC…</span>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={() => window.openRoom.getAppInfo().then(setInfo)}>Refresh over IPC</Button>
        <Button variant="outline" onClick={() => setInfo(null)}>
          Clear
        </Button>
      </div>
    </main>
  )
}

export default App
