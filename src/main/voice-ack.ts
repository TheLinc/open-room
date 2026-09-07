import { speakableAsIs } from './condense'

/**
 * What is said back, immediately, to a prompt that arrived by voice.
 *
 * By text the user watches the reply stream in. By voice the pill turns and
 * then nothing is heard for two to eight seconds until the agent's first
 * output, which with the window hidden is where voice starts to feel
 * unreliable. This is the app's own line, no model call: system synthesis
 * is about 265 ms. It goes out at `progress` priority so a question or a
 * blocker preempts it and the bus keeps only the latest, which is what lets
 * the agent's own opening line replace it if that arrives first. No agent
 * name, so the app's own audio can never form a wake phrase.
 */
export function acknowledgement(turn: { queued: boolean }): string {
  return turn.queued ? 'Queued, after this task.' : 'On it.'
}

/**
 * Which assistant message is the turn's opening.
 *
 * Measured: with extended thinking the first assistant message of a turn is
 * often a thinking block on its own, and judging that one meant the real
 * opening line was never considered. A thinking-only message is waited
 * past; the first message carrying text offers it; one that opens with a
 * tool call and no text ends the search with nothing to say.
 */
export function openingCandidate(message: {
  message?: { content?: unknown }
}): { kind: 'wait' } | { kind: 'text'; text: string } | { kind: 'tool' } {
  const content = message.message?.content
  if (typeof content === 'string') return { kind: 'text', text: content }
  if (!Array.isArray(content)) return { kind: 'wait' }

  const blocks = content.filter(
    (candidate): candidate is { type: string; text?: unknown } =>
      Boolean(candidate) && typeof candidate === 'object'
  )
  const text = blocks.find((block) => block.type === 'text')
  if (text) return { kind: 'text', text: String(text.text ?? '') }
  if (blocks.some((block) => block.type === 'tool_use')) return { kind: 'tool' }
  return { kind: 'wait' }
}

/**
 * The agent's own opening line, spoken as the voice analogue of watching the
 * reply begin. Only the first assistant message of a voice-initiated turn,
 * and only when it can be spoken as written: condensing it would take six to
 * nine seconds, which is longer than the silence it would fill. A turn that
 * opens with a tool call says nothing here; the agent's `speak` guidance
 * covers the rest.
 */
export function openingLine(
  turn: { byVoice: boolean; openingSpoken: boolean },
  text: string
): string | null {
  if (!turn.byVoice || turn.openingSpoken) return null
  return speakableAsIs(text)
}
