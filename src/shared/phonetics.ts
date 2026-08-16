import { doubleMetaphone } from 'double-metaphone'

/**
 * Agent names are matched against Whisper transcripts, not typed text, so
 * collisions are acoustic rather than lexical. `Sky` and `Skye` differ by one
 * character and are indistinguishable when spoken; `Atlas` and `Atlas-2`
 * differ by two and are also indistinguishable. Edit distance is the wrong
 * tool — a phonetic key is the right one.
 */

export type NameWarning = {
  kind: 'collision' | 'too-short' | 'common-word'
  message: string
}

/** Both double-metaphone codes; the secondary catches alternate pronunciations. */
export function phoneticKeys(name: string): [string, string] {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return ['', '']

  // Multi-word names are keyed word by word so "Sky Blue" and "Skye Blue"
  // still collide.
  const parts = normalized.split(' ').map((word) => doubleMetaphone(word))
  return [parts.map((p) => p[0]).join(' '), parts.map((p) => p[1]).join(' ')]
}

/** True when two names would sound alike to the wake matcher. */
export function namesCollide(a: string, b: string): boolean {
  const [aPrimary, aSecondary] = phoneticKeys(a)
  const [bPrimary, bSecondary] = phoneticKeys(b)

  if (!aPrimary || !bPrimary) return false

  return (
    aPrimary === bPrimary ||
    aPrimary === bSecondary ||
    aSecondary === bPrimary ||
    (aSecondary !== '' && aSecondary === bSecondary)
  )
}

/**
 * Words common enough in ordinary speech that `hey <word>` can plausibly occur
 * by accident, or that a short transcript could fuzzy-match onto. Not a
 * dictionary — just the high-frequency conversational core.
 */
const COMMON_SPEECH_WORDS = new Set([
  'there',
  'you',
  'man',
  'guys',
  'look',
  'listen',
  'wait',
  'stop',
  'come',
  'go',
  'now',
  'ok',
  'okay',
  'yeah',
  'yes',
  'no',
  'so',
  'well',
  'but',
  'and',
  'what',
  'why',
  'how',
  'who',
  'where',
  'when',
  'ready',
  'start',
  'run',
  'open',
  'close',
  'next',
  'back',
  'here',
  'help',
  'hold',
  'up',
  'down',
  'left',
  'right',
  'more',
  'less',
  'good',
  'bad',
  'new',
  'old',
  'one',
  'two',
  'three',
  'first',
  'last',
  'this',
  'that',
  'them',
  'they',
  'him',
  'her',
  'it',
  'me',
  'we',
  'us',
  'i',
  'can',
  'will',
  'do',
  'did',
  'done',
  'make',
  'made',
  'get',
  'got',
  'give',
  'take',
  'see',
  'saw',
  'know',
  'think',
  'want',
  'need',
  'like',
  'time',
  'day',
  'way',
  'thing',
  'work',
  'call',
  'try',
  'ask',
  'tell',
  'say',
  'said',
  'play',
  'sorry',
  'please',
  'thanks',
  'hello',
  'hi',
  'bye',
  'sure',
  'maybe',
  'really',
  'just',
  'only',
  'also',
  'even',
  'still',
  'again',
  'never',
  'always',
  'some',
  'any',
  'all',
  'both',
  'each',
  'other',
  'same',
  'own',
  'out',
  'off',
  'over'
])

/** Rough vowel-group count. Only drives a soft warning, so approximate is fine. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1

  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '')

  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length)
}

/**
 * Validates a candidate name against the existing roster and against the
 * qualities that make a name work as a wake word. Warnings, not errors —
 * the user may know better, but should be told.
 */
export function checkAgentName(name: string, existingNames: string[]): NameWarning[] {
  const warnings: NameWarning[] = []
  const trimmed = name.trim()
  if (!trimmed) return warnings

  const collidesWith = existingNames.find(
    (existing) =>
      existing.toLowerCase() !== trimmed.toLowerCase() && namesCollide(trimmed, existing)
  )

  if (collidesWith) {
    warnings.push({
      kind: 'collision',
      message: `Sounds like “${collidesWith}”. Voice commands may reach the wrong agent.`
    })
  }

  const words = trimmed.toLowerCase().split(/\s+/)
  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0)

  if (totalSyllables <= 1) {
    warnings.push({
      kind: 'too-short',
      message: 'One syllable gives the wake matcher little to work with. Two or more is safer.'
    })
  }

  const commonWord = words.find((w) => COMMON_SPEECH_WORDS.has(w))
  if (commonWord) {
    warnings.push({
      kind: 'common-word',
      message: `“${commonWord}” is common in everyday speech, so this name may trigger by accident.`
    })
  }

  return warnings
}
