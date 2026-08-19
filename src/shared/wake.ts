import { phoneticKeys } from './phonetics'

/**
 * Finding "hey <agent>" at the front of a transcript.
 *
 * Matching is phonetic, not lexical: this runs against open Whisper
 * transcription, where the name arrives as whatever the model heard. `Atlas`
 * and `Atlus` are the same sound and must both hit; edit distance would also
 * accept `Atlas` for `Atlantic`, which is a different word entirely.
 *
 * The `hey` prefix is load-bearing and not decoration. The SpeechBus prefixes
 * spoken lines with a bare agent name (`"Atlas — the build is green"`), so
 * requiring `hey` means TTS output cannot form a valid wake phrase no matter
 * what an agent says. That is a structural guarantee rather than a heuristic,
 * and it is the first of the three self-trigger defences.
 */

export type WakeCandidate = {
  id: string
  name: string
}

export type WakeMatch = {
  agentId: string
  /**
   * Everything after the wake phrase.
   *
   * Empty when the user said only "hey <name>" — an address with nothing to
   * do yet, which the caller may treat as a request to start listening rather
   * than as a prompt.
   */
  prompt: string
}

/**
 * Whisper renders the prefix loosely and it is the one word we require, so a
 * couple of near-homophones are accepted. None of these can appear at the
 * front of a spoken agent line, so widening this does not weaken the
 * self-trigger guarantee.
 */
const PREFIXES = new Set(['hey', 'hay', 'ey'])

/** Longest agent name we will look for, in words. */
const MAX_NAME_WORDS = 4

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function soundsLike(spoken: string[], name: string): boolean {
  const [namePrimary, nameSecondary] = phoneticKeys(name)
  if (!namePrimary) return false

  const [spokenPrimary, spokenSecondary] = phoneticKeys(spoken.join(' '))
  if (!spokenPrimary) return false

  return (
    spokenPrimary === namePrimary ||
    spokenPrimary === nameSecondary ||
    spokenSecondary === namePrimary ||
    (spokenSecondary !== '' && spokenSecondary === nameSecondary)
  )
}

/**
 * The agent addressed at the start of a transcript, if any.
 *
 * Anchored to the front deliberately: "I told him hey Derek would know" is a
 * sentence about an agent, not an instruction to one. A segment that begins
 * mid-sentence simply does not match, which is the safe direction to fail.
 */
export function matchWake(transcript: string, agents: WakeCandidate[]): WakeMatch | null {
  const spoken = words(transcript)
  if (spoken.length < 2) return null
  if (!PREFIXES.has(spoken[0])) return null

  const rest = spoken.slice(1)

  // Longest name first, so "Code Review" wins over an agent called "Code".
  for (let length = Math.min(MAX_NAME_WORDS, rest.length); length >= 1; length -= 1) {
    const candidate = rest.slice(0, length)

    for (const agent of agents) {
      if (!soundsLike(candidate, agent.name)) continue
      return { agentId: agent.id, prompt: rest.slice(length).join(' ') }
    }
  }

  return null
}

/**
 * Whether a transcript is probably this app's own speech coming back.
 *
 * The third self-trigger defence, behind the `hey` requirement and the
 * suppression window. Playback leaks into the microphone on any machine
 * without perfect echo cancellation, and an agent that answers its own voice
 * is both a loop and a way for a spoken line to run a command.
 */
export function echoesPlayback(transcript: string, playing: string, threshold = 0.6): boolean {
  const heard = words(transcript)
  const said = new Set(words(playing))
  if (heard.length === 0 || said.size === 0) return false

  const overlap = heard.filter((word) => said.has(word)).length
  return overlap / heard.length >= threshold
}
