import { useState } from 'react'
import { ExternalLink, KeyRound, RefreshCw } from 'lucide-react'
import { distrosOf, loginGate, type Environment, type LoginSnapshot } from '@shared/login'
import { Button } from '@/components/ui/button'

const INSTALL_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup'

/**
 * What the window shows instead of the agent list while no environment the
 * agents run in has a usable Claude Code login.
 *
 * Open Room runs agents on the account signed in to Claude Code and never
 * handles keys of its own, so there is nothing to type here — only the
 * things the user has to do elsewhere, and a button to check again. The
 * login itself is a browser flow the CLI drives; it cannot be run from
 * inside the app. Each environment gets its own step: the host's login and
 * a WSL distro's are separate `~/.claude` directories, and signing in on one
 * side does nothing for the other.
 */
export function FirstRun({
  snapshot,
  agents,
  onRecheck
}: {
  snapshot: LoginSnapshot
  agents: readonly Environment[]
  onRecheck: () => Promise<LoginSnapshot>
}): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [stillOut, setStillOut] = useState(false)

  const hostUsed = agents.length === 0 || agents.some((agent) => !agent.wsl)
  const distros = distrosOf(agents).filter((d) => snapshot.wsl[d]?.state === 'signed-out')

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await onRecheck()
      setStillOut(loginGate(result, agents) === 'first-run')
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
          Open Room runs its agents on the Claude Code account signed in where they run. It never
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
          {hostUsed && (
            <li>
              Open a terminal, run <Code>claude</Code> and follow the sign-in prompt. A browser
              window completes it.
            </li>
          )}
          {distros.map((distro) => (
            <li key={distro}>
              For agents in <span className="font-medium">{distro}</span>: run{' '}
              <Code>wsl -d {distro}</Code>, then <Code>claude</Code>, and follow the sign-in prompt.
              The distro has its own login.
            </li>
          ))}
          <li>Come back here and check again.</li>
        </ol>

        <div className="flex items-center gap-3">
          <Button onClick={() => void recheck()} disabled={checking}>
            <RefreshCw className={checking ? 'animate-spin' : ''} /> Check again
          </Button>
          {stillOut && <span className="text-sm text-muted-foreground">Still signed out.</span>}
        </div>
      </div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
}
