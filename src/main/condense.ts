import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildChildEnv } from './agent-errors'
import { bundledClaudePath } from './claude-binary'

/**
 * Turns a finished turn's final text into one spoken sentence.
 *
 * This is the silence fallback: an agent that finishes without calling
 * `speak` would otherwise end its turn in silence, leaving no signal that it
 * is done. It fires only when the agent stayed quiet, so one that speaks for
 * itself never pays for it.
 *
 * Routed through the Agent SDK deliberately. Reaching for `@anthropic-ai/sdk`
 * here would need an API key and break the promise that Open Room only ever
 * spends the user's own Claude Code subscription.
 */

/**
 * Whether a finished turn should be spoken on the agent's behalf.
 *
 * There is deliberately no duration test. One used to sit here at 30s, on the
 * reasoning that silence after a short turn is not confusing — but a turn is
 * a protocol boundary and says nothing about whether the work mattered, and
 * ordinary turns land well under it. The effect was that agents finished
 * silently almost always, which reads as broken speech rather than as a
 * considered default.
 *
 * `alreadySpoke` is the one that keeps this rare in practice: an agent
 * following its `AGENT.md` says something better than this can, mid-task and
 * written for the ear, and speaking again after it would be repetition.
 */
/**
 * Longest reply spoken without condensing.
 *
 * Roughly 35 words, or fifteen seconds aloud. Past this a completion line
 * stops being a signal and becomes a recital, which is what condensing is
 * for — and the wait is easier to justify against text that was going to be
 * long anyway.
 */
export const MAX_SPOKEN_CHARS = 200

/**
 * Things that read badly aloud, or mean the text has structure.
 *
 * Deliberately eager: a false negative costs one condense call, while a false
 * positive means hearing a code fence or a file path read out character by
 * character. Anything uncertain should fall through to the model.
 */
const UNSPEAKABLE = [
  /\r|\n/, // more than one line implies a list, table or heading
  /[`*_#|~]/, // code spans, emphasis, headings, tables
  /\[[^\]]*\]\([^)]*\)/, // markdown links
  /https?:\/\//i,
  /\bwww\./i,
  /[\\/]\w/, // a path separator biting into a word
  /\b\w+\.(ts|tsx|js|jsx|json|md|css|html|py|sh|ps1|yml|yaml|toml|lock|txt|log)\b/i,
  /\d+:\d+/ // file:line, or a timestamp, neither of which speaks well
]

/**
 * Returns the reply if it can simply be spoken, or null to condense it.
 *
 * This exists because condensing cannot be made fast. Measured against the
 * real path: a fresh `query()` costs 8–9s end to end, of which only ~780ms is
 * CLI startup — and the floor is the round trip itself, since a prompt as
 * small as "Reply with the word ok." still took 6.3s. Keeping a warm session
 * alive brings later calls to about 3.3s, still a plain gap, and at the price
 * of a resident `claude` subprocess that the app's own concurrency cap exists
 * to avoid.
 *
 * So the only way to speak promptly is not to ask. Most replies that end a
 * turn are already one or two plain sentences — "the directory is empty",
 * "all forty-two tests passed" — and those are better spoken as written than
 * paraphrased eight seconds later. The rest still go to the model.
 */
export function speakableAsIs(finalText: string): string | null {
  const text = finalText.trim()
  if (text.length === 0 || text.length > MAX_SPOKEN_CHARS) return null
  if (UNSPEAKABLE.some((pattern) => pattern.test(text))) return null
  return text
}

export function shouldSpeakFallback(turn: {
  ttsEnabled: boolean
  alreadySpoke: boolean
  /** Interrupts and failures are not completions and must stay silent. */
  succeeded: boolean
  interrupted: boolean
}): boolean {
  if (!turn.ttsEnabled) return false
  if (turn.alreadySpoke) return false
  if (!turn.succeeded || turn.interrupted) return false
  return true
}

const INSTRUCTION = [
  'Rewrite the following as a single spoken sentence telling the user what happened.',
  'Plain prose for text-to-speech: no markdown, no file paths, no code, no lists.',
  'Under 20 words. Reply with the sentence only.'
].join(' ')

export async function condenseForSpeech(
  finalText: string,
  claudeExecutable: string | null = bundledClaudePath()
): Promise<string | null> {
  const trimmed = finalText.trim()
  if (!trimmed) return null

  try {
    for await (const message of query({
      prompt: `${INSTRUCTION}\n\n---\n${trimmed.slice(0, 4000)}`,
      options: {
        model: 'claude-haiku-4-5',
        // No tools, no Claude Code preset, no filesystem settings — this is a
        // one-shot rewrite, not an agent, and it has no business inheriting
        // the machine's plugins or hooks. It is for isolation only: measured
        // either way, it makes no difference to latency, which is dominated
        // by the round trip rather than by startup.
        systemPrompt: 'You rewrite text into one short spoken sentence.',
        settingSources: [],
        allowedTools: [],
        maxTurns: 1,
        persistSession: false,
        env: buildChildEnv(),
        ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {})
      }
    })) {
      if (message.type === 'result') {
        if (message.subtype !== 'success') return null
        const result = message.result.trim()
        return result.length > 0 ? result : null
      }
    }
  } catch {
    // The fallback is a courtesy. Failing it must never affect the turn that
    // has already completed successfully.
    return null
  }

  return null
}
