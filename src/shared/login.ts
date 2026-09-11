import { wslLoginHint } from './wsl'

/** One environment's Claude Code login, as `claude auth status` reports it. */
export type LoginStatus =
  | { state: 'signed-in'; email?: string; authMethod?: string; subscriptionType?: string }
  | { state: 'signed-out' }
  /** The check could not run or could not be read; agents may still work. */
  | { state: 'unknown' }

/**
 * The logins Open Room can see, one per environment an agent can run in.
 *
 * A login belongs to an environment, not to the machine: the host's
 * `~/.claude` and each WSL distro's are separate, and a token can expire in
 * one while the other stays signed in. The first version held one status
 * for the host and locked the whole window behind the first-run screen when
 * it was signed out, which shut out an install whose only working login was
 * inside a distro. `wsl` is keyed by distro name and holds only the distros
 * some agent uses; a distro that has not been probed reads as `unknown`.
 */
export type LoginSnapshot = {
  host: LoginStatus
  wsl: Record<string, LoginStatus>
}

/** The part of an agent's config that says where it runs. */
export type Environment = { wsl: { distro: string } | null }

/** Each distro some agent runs in, once, in first-seen order. */
export function distrosOf(agents: readonly Environment[]): string[] {
  const seen: string[] = []
  for (const agent of agents) {
    const distro = agent.wsl?.distro
    if (distro && !seen.includes(distro)) seen.push(distro)
  }
  return seen
}

/** The login the agent's own environment has. */
export function loginFor(snapshot: LoginSnapshot, agent: Environment): LoginStatus {
  if (!agent.wsl) return snapshot.host
  return snapshot.wsl[agent.wsl.distro] ?? { state: 'unknown' }
}

/**
 * Whether the window is the first-run screen or the app.
 *
 * First run only when every environment the agents use is known to be
 * signed out; with no agents yet, the host is the environment. One usable
 * environment keeps the app open, and the agents whose environment is
 * signed out say so in their own pane (`loginNotice`). `unknown` never
 * locks anyone out: the check is a diagnostic, and a working install must
 * not be shut behind it.
 */
export function loginGate(
  snapshot: LoginSnapshot,
  agents: readonly Environment[]
): 'first-run' | 'open' {
  const hostUsed = agents.length === 0 || agents.some((agent) => !agent.wsl)
  const environments: Environment[] = [
    ...(hostUsed ? [{ wsl: null }] : []),
    ...distrosOf(agents).map((distro) => ({ wsl: { distro } }))
  ]
  const allOut = environments.every((env) => loginFor(snapshot, env).state === 'signed-out')
  return allOut ? 'first-run' : 'open'
}

/** The line an agent's pane shows while its environment is signed out. */
export function loginNotice(snapshot: LoginSnapshot, agent: Environment): string | null {
  if (loginFor(snapshot, agent).state !== 'signed-out') return null
  if (agent.wsl) return wslLoginHint(agent.wsl.distro)
  return 'Claude Code on this computer is not signed in. Open a terminal, run `claude`, and sign in.'
}
