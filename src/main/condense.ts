import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { turnOutcome } from '@shared/turn-outcome'
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

/**
 * Markdown structure taken out of a reply, leaving the prose on one line.
 *
 * Emphasis, headings, blockquotes and list markers go; a link keeps its text
 * and loses its address. Code spans and fences are left as they are, so a
 * sentence carrying one still fails `speakableAsIs` and goes to the model.
 */
export function flattenMarkup(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-•*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The opening sentences of a structured reply, spoken as written.
 *
 * `speakableAsIs` sends any reply with a list, emphasis or a second line to
 * the model, and that call is 7 to 9 s of silence after the turn (measured
 * 6.6 s and 9.4 s on the day this was added). Most such replies open with a
 * plain sentence or two before the structure starts, and those are spoken
 * here instead, at no cost. Sentences are taken from the flattened text up
 * to `MAX_SPOKEN_CHARS`, and the walk stops at the first one that is not
 * speakable on its own; an opening sentence with code or a path in it means
 * nothing is spoken here and the model still gets the reply. The bias is
 * unchanged: a lead is spoken only when every sentence in it would have
 * passed on its own.
 */
export function speakableLead(finalText: string): string | null {
  const flat = flattenMarkup(finalText)
  if (!flat) return null

  // Split after a terminator followed by space, never on the terminator
  // alone: `condense.ts` must stay inside its sentence so the path check
  // sees it, rather than leaving "ts now." behind as a sentence of its own.
  const sentences = flat.split(/(?<=[.!?])\s+/)

  let lead = ''
  for (const raw of sentences) {
    const sentence = raw.trim()
    if (!speakableAsIs(sentence)) break
    const next = lead ? `${lead} ${sentence}` : sentence
    if (next.length > MAX_SPOKEN_CHARS) break
    lead = next
  }
  return lead || null
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

/**
 * What the condense turn's result is worth speaking.
 *
 * `subtype` and `is_error` disagree on the bundled CLI: an expired or
 * missing login ends the turn `subtype: 'success'`, `is_error: true`, with
 * "Failed to authenticate…" in `result`. Reading the subtype alone took that
 * sentence for the summary and spoke it, while the chat showed the agent's
 * real reply. The same three-way reading the supervisor applies to a turn
 * applies here.
 */
export function condensedLine(result: {
  subtype: string
  is_error?: boolean
  result?: string
}): string | null {
  if (turnOutcome(result, false) !== 'success') return null
  const line = (result.result ?? '').trim()
  return line.length > 0 ? line : null
}

export type CondenseSpawn = {
  /** The host binary; the default is the SDK's bundled one, unpacked. */
  claudeExecutable?: string | null
  /**
   * How the CLI is started, for an agent whose `claude` runs inside a WSL
   * distro. The summary must come from the same login as the reply it
   * summarises: this used to spawn the host binary for every agent, so a
   * WSL agent signed in only inside its distro got its reply from there and
   * its spoken summary from a signed-out host.
   */
  spawnClaudeCodeProcess?: Options['spawnClaudeCodeProcess']
}

export async function condenseForSpeech(
  finalText: string,
  spawnWith: CondenseSpawn = {}
): Promise<string | null> {
  const trimmed = finalText.trim()
  if (!trimmed) return null
  const claudeExecutable =
    spawnWith.claudeExecutable === undefined ? bundledClaudePath() : spawnWith.claudeExecutable
  const spawnClaudeCodeProcess = spawnWith.spawnClaudeCodeProcess

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
        ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
        ...(spawnClaudeCodeProcess ? { spawnClaudeCodeProcess } : {})
      }
    })) {
      if (message.type === 'result') {
        return condensedLine({
          subtype: message.subtype,
          is_error: message.is_error,
          result: 'result' in message ? message.result : undefined
        })
      }
    }
  } catch {
    // The fallback is a courtesy. Failing it must never affect the turn that
    // has already completed successfully.
    return null
  }

  return null
}
