/**
 * What an agent says out loud, and how competing utterances are ordered.
 *
 * Speech content never comes from the transcript. Agents choose what is worth
 * saying by calling the `speak` tool, so the spoken line arrives verbatim and
 * the chat pane stays exactly what Claude Code would have shown.
 */

export const SPEECH_PRIORITIES = ['question', 'blocker', 'done', 'progress'] as const

export type SpeechPriority = (typeof SPEECH_PRIORITIES)[number]

/**
 * Higher wins. A question interrupts a progress update; nothing interrupts a
 * question.
 */
export const PRIORITY_RANK: Record<SpeechPriority, number> = {
  question: 3,
  blocker: 2,
  done: 1,
  progress: 0
}

export type Utterance = {
  id: string
  agentId: string
  agentName: string
  text: string
  priority: SpeechPriority
  queuedAt: number
}

/**
 * How long a `progress` update stays worth saying.
 *
 * Expiry applies to `progress` only. A `question` stuck behind a long
 * `blocker` must still be spoken — an unheard question is the worst failure
 * this app can produce.
 */
export const PROGRESS_TTL_MS = 30_000

/** Queue depth at which the rest is collapsed into a single notification. */
export const BURST_THRESHOLD = 3

/** Most a single agent may say aloud in one turn, before overflow is dropped. */
export const SPEAK_CALLS_PER_TURN = 4

export function isExpired(utterance: Utterance, now: number): boolean {
  // Only progress expires; every other tier is worth hearing late.
  return utterance.priority === 'progress' && now - utterance.queuedAt > PROGRESS_TTL_MS
}

/** Sorts by priority, then FIFO within a tier. */
export function compareUtterances(a: Utterance, b: Utterance): number {
  const byPriority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
  return byPriority !== 0 ? byPriority : a.queuedAt - b.queuedAt
}
