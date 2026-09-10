import type { SpeechPriority } from './speech'

/**
 * Whether a spoken line is worth saying to someone who is already reading it.
 *
 * Speech follows attention, not the input route. Whether a prompt was typed
 * or spoken says where the user was when the turn started; what matters is
 * where they are when the agent has something to say, and those differ
 * whenever a turn outlasts a glance. Reading the reply as it streams and
 * hearing it a beat later is the same information twice, and with several
 * agents it is a room of people reading their screens at you. Being away
 * from the pane is the case the whole voice layer exists for.
 *
 * Questions and blockers are exempt: an unheard question is the worst
 * outcome the app can produce, and a voice carries "I need you" in a way a
 * row in a pane does not. That matches the bus's own rule that those two
 * never expire.
 *
 * Decided at the moment playback would start, never when the line was
 * queued: the bus serialises speech, so a line can wait behind another
 * agent's sentence while the user walks away or sits down.
 */

export type Attention = {
  /** The main window is focused; a hidden window never is. */
  windowFocused: boolean
  /** The agent whose pane is on screen, or null. */
  selectedAgentId: string | null
}

/** True when the user is looking at this agent's pane right now. */
export function watching(attention: Attention, agentId: string): boolean {
  return attention.windowFocused && attention.selectedAgentId === agentId
}

/** Whether a line of this priority should play, given who is watching. */
export function speechAllowed(
  priority: SpeechPriority,
  watched: boolean,
  speakWhenWatching: boolean
): boolean {
  if (priority === 'question' || priority === 'blocker') return true
  return !watched || speakWhenWatching
}
