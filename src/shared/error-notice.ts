import type { AgentRuntime } from './agent-runtime'

/**
 * Whether a runtime update deserves a native notification for a failure,
 * and what it says.
 *
 * Only on the step into `error`. The supervisor re-emits the whole runtime
 * on every patch, so anything looser would toast the same failure again on
 * the next unrelated field change — the quota heartbeat problem, in a
 * different coat. A turn that fails is otherwise invisible to someone away
 * from the window: the silence fallback runs on success only, and the HUD
 * pip carries no sound.
 */
export function errorNotification(
  previousState: AgentRuntime['state'] | undefined,
  runtime: AgentRuntime,
  agentName: string
): { title: string; body: string } | null {
  if (runtime.state !== 'error' || previousState === 'error') return null
  const message = runtime.error?.message ?? 'Unknown error'
  const body = runtime.error?.hint ? `${message}\n${runtime.error.hint}` : message
  return { title: `${agentName} hit an error`, body }
}
