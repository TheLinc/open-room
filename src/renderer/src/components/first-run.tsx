import { useState } from 'react'
import { ExternalLink, KeyRound, RefreshCw } from 'lucide-react'
import type { LoginStatus } from '@shared/login'
import { Button } from '@/components/ui/button'

const INSTALL_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup'

/**
 * What the window shows instead of the agent list while no Claude Code
 * login is usable.
 *
 * Open Room runs agents on the account signed in to Claude Code on this
 * machine and never handles keys of its own, so there is nothing to type
 * here — only the two things the user has to do elsewhere, and a button to
 * check again. The login itself is a browser flow the CLI drives; it cannot
 * be run from inside the app.
 */
export function FirstRun({
  status,
  onRecheck
}: {
  status: LoginStatus
  onRecheck: () => Promise<LoginStatus>
}): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [lastResult, setLastResult] = useState<LoginStatus['state'] | null>(null)

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await onRecheck()
      setLastResult(result.state)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-lg flex-col gap-5">
        <div className="flex items-center gap-3">
          <KeyRound className="size-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Claude Code first</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Open Room runs its agents on the Claude Code account signed in on this computer. It never
          asks for an API key and never uses anyone else&apos;s account — every agent&apos;s usage
          bills the login below, exactly as the terminal does.
        </p>

        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>
            <span className="font-medium">Install Claude Code</span> if you have not already.{' '}
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              Setup guide <ExternalLink className="size-3" />
            </a>
          </li>
          <li>
            Open a terminal, run{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">claude</code> and
            follow the sign-in prompt. A browser window completes it.
          </li>
          <li>Come back here and check again.</li>
        </ol>

        <div className="flex items-center gap-3">
          <Button onClick={() => void recheck()} disabled={checking}>
            <RefreshCw className={checking ? 'animate-spin' : ''} /> Check again
          </Button>
          {lastResult === 'signed-out' && (
            <span className="text-sm text-muted-foreground">Still signed out.</span>
          )}
          {lastResult === 'unknown' && (
            <span className="text-sm text-muted-foreground">
              Could not check. You can still try an agent.
            </span>
          )}
        </div>

        {status.state === 'unknown' && (
          <p className="text-xs text-muted-foreground">
            The login check could not run, so this may be a false alarm. Agents will tell you if
            they cannot sign in.
          </p>
        )}
      </div>
    </div>
  )
}
