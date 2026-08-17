import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildChildEnv } from './agent-errors'

/**
 * Turns a finished turn's final text into one spoken sentence.
 *
 * This is the silence fallback: if an agent finishes a long run without
 * calling `speak`, the user is left with no idea it ended. It fires only when
 * needed, so a well-behaved agent never pays for it.
 *
 * Routed through the Agent SDK deliberately. Reaching for `@anthropic-ai/sdk`
 * here would need an API key and break the promise that Open Room only ever
 * spends the user's own Claude Code subscription.
 */

/** Below this, silence is not confusing and the extra call is not worth it. */
export const FALLBACK_MIN_TURN_MS = 30_000

const INSTRUCTION = [
  'Rewrite the following as a single spoken sentence telling the user what happened.',
  'Plain prose for text-to-speech: no markdown, no file paths, no code, no lists.',
  'Under 20 words. Reply with the sentence only.'
].join(' ')

export async function condenseForSpeech(finalText: string): Promise<string | null> {
  const trimmed = finalText.trim()
  if (!trimmed) return null

  try {
    for await (const message of query({
      prompt: `${INSTRUCTION}\n\n---\n${trimmed.slice(0, 4000)}`,
      options: {
        model: 'claude-haiku-4-5',
        // No tools, no Claude Code preset, no project settings — this is a
        // one-shot rewrite, not an agent.
        systemPrompt: 'You rewrite text into one short spoken sentence.',
        allowedTools: [],
        maxTurns: 1,
        persistSession: false,
        env: buildChildEnv()
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
