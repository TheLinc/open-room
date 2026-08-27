import { spawn } from 'node:child_process'
import { bundledClaudePath } from './claude-binary'

/**
 * Whether the machine's Claude Code login is usable, asked of the CLI the
 * SDK itself runs.
 *
 * The SDK ships its own `claude` binary as a platform-specific optional
 * dependency and uses it by default, so agents never need a global install —
 * only the credentials in `~/.claude`, which every CLI shares. Open Room
 * therefore asks *that* binary, not whatever `claude` is on PATH: a global
 * install that is signed in while the bundled one somehow is not would be a
 * confident wrong answer, and the reverse would lock a working app behind the
 * first-run screen.
 */

import type { LoginStatus } from '@shared/login'

export type { LoginStatus }

/** Reads `claude auth status --json`. Anything unreadable is `unknown`, never `signed-out`. */
export function parseAuthStatus(stdout: string): LoginStatus {
  const start = stdout.indexOf('{')
  if (start < 0) return { state: 'unknown' }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.slice(start))
  } catch {
    return { state: 'unknown' }
  }

  const info = parsed as {
    loggedIn?: unknown
    email?: unknown
    authMethod?: unknown
    subscriptionType?: unknown
  } | null
  if (typeof info?.loggedIn !== 'boolean') return { state: 'unknown' }
  if (!info.loggedIn) return { state: 'signed-out' }

  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return {
    state: 'signed-in',
    ...(str(info.email) ? { email: str(info.email) } : {}),
    ...(str(info.authMethod) ? { authMethod: str(info.authMethod) } : {}),
    ...(str(info.subscriptionType) ? { subscriptionType: str(info.subscriptionType) } : {})
  }
}

/** Runs the check. Never throws: a failed spawn is `unknown`. */
export function checkLogin(binary: string | null = bundledClaudePath()): Promise<LoginStatus> {
  if (!binary) return Promise.resolve({ state: 'unknown' })
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(binary, ['auth', 'status', '--json'], {
      env: withoutApiKey(process.env),
      windowsHide: true
    })
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('error', () => resolve({ state: 'unknown' }))
    child.on('close', () => resolve(parseAuthStatus(out)))
    setTimeout(() => {
      child.kill()
      resolve({ state: 'unknown' })
    }, 15_000).unref()
  })
}

/** The same rule agents run under: an API key must not masquerade as a login. */
function withoutApiKey(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env }
  delete copy.ANTHROPIC_API_KEY
  return copy
}
