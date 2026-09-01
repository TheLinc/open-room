import type { AgentRuntime } from './agent-runtime'
import type { SpeechPriority } from './speech'

/**
 * "This agent is waiting for you."
 *
 * A `speak` call with `question` or `blocker` priority is the agent asking for
 * something, and its turn then ends and waits. Nothing in the SDK records
 * that: the turn is a `success` like any other, the agent reports `ready`,
 * and with the main window hidden the ask is a sentence of audio that is gone
 * as soon as it is spoken. These decisions turn the ask into runtime state so
 * the HUD can show it and push-to-talk can aim at it.
 */

export type Awaiting = {
  /** The line the agent spoke, verbatim. */
  text: string
  /** Epoch ms of the turn ending; the newest ask is the one a reply goes to. */
  since: number
}

/** Whether a spoken line with this priority expects an answer. */
export function asksForReply(priority: SpeechPriority): boolean {
  return priority === 'question' || priority === 'blocker'
}

export type TurnOutcome = {
  /** The last question or blocker spoken this turn, or null. */
  asked: string | null
  isError: boolean
  wasInterrupted: boolean
}

/**
 * What a finished turn leaves the agent waiting on.
 *
 * Only a turn that ended normally counts: an error is shown as an error, and
 * an interrupt was the user's own doing. Layering "waiting for you" over
 * either would aim a reply at a session that may not take it.
 */
export function awaitingAfterTurn(outcome: TurnOutcome, now: number): Awaiting | null {
  if (outcome.asked === null || outcome.isError || outcome.wasInterrupted) return null
  return { text: outcome.asked, since: now }
}

/** The agent whose ask is newest, or null when nobody is waiting. */
export function mostRecentAwaiting(runtimes: AgentRuntime[]): string | null {
  let best: { agentId: string; since: number } | null = null
  for (const runtime of runtimes) {
    if (!runtime.awaiting) continue
    if (!best || runtime.awaiting.since > best.since) {
      best = { agentId: runtime.agentId, since: runtime.awaiting.since }
    }
  }
  return best?.agentId ?? null
}

/**
 * Which agent a capture addresses.
 *
 * A per-agent hotkey or a wake phrase names its agent and that always wins.
 * The global hotkey means "the agent I am dealing with", which while a
 * question is outstanding is the one that asked it, not the one the main
 * window happens to have selected. The pill names the target before anyone
 * speaks, so the redirect is visible and Esc discards it.
 */
export function captureTarget(input: {
  explicit: string | null
  awaiting: string | null
  selected: string | null
}): string | null {
  return input.explicit ?? input.awaiting ?? input.selected
}
