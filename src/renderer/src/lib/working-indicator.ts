import type { TranscriptEntry } from '@shared/agent-runtime'
import { isPrompt } from '@shared/files-changed'

/**
 * What the strip at the base of the chat says while an agent works.
 *
 * The header's "Working" is true but flat: a turn that has run for a minute
 * looks exactly like one that started a second ago, and nothing says whether
 * the model is thinking or a tool is running. This gives the wait a shape,
 * the way the terminal's spinner does, with a verb that changes now and
 * then so a long turn does not read as stuck, the elapsed time, and the
 * tool in flight when there is one.
 *
 * Every decision is here and pure; the component only draws.
 */

/** The verbs, all of one shape so an ellipsis fits every one of them. */
export const WORKING_VERBS = [
  'Pondering',
  'Noodling',
  'Rummaging',
  'Tinkering',
  'Mulling',
  'Percolating',
  'Sleuthing',
  'Untangling',
  'Marinating',
  'Spelunking',
  'Cogitating',
  'Brewing',
  'Scheming',
  'Puzzling',
  'Sifting',
  'Wrangling',
  'Assembling',
  'Conjuring',
  'Deliberating',
  'Fiddling',
  'Ruminating',
  'Crunching',
  'Weaving',
  'Plotting',
  'Composing',
  'Hatching',
  'Foraging',
  'Simmering',
  'Musing',
  'Tallying'
] as const

/** How long one verb stays up before the next takes over. */
export const VERB_ROTATION_MS = 8_000

/**
 * The verb for a turn at a moment in it.
 *
 * Seeded by the turn (its start time) so re-renders never flicker between
 * words, and stepped by elapsed time so a long turn moves on.
 */
export function workingVerb(seed: number, elapsedMs: number): string {
  const step = Math.floor(Math.max(0, elapsedMs) / VERB_ROTATION_MS)
  const index = (Math.abs(Math.floor(seed)) + step) % WORKING_VERBS.length
  return WORKING_VERBS[index]
}

export function describeElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

/**
 * When the current turn began: the time main stamped on the last prompt.
 *
 * The supervisor emits the user's prompt itself, stamped as it is sent, so
 * the transcript already carries the turn's start and the renderer never
 * has to read a clock during render. Falls back to the runtime's last
 * activity for a turn whose prompt is not in the live list.
 */
export function turnStartedAt(entries: TranscriptEntry[], fallback: number): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isPrompt(entries[i])) return entries[i].receivedAt || fallback
  }
  return fallback
}

type Block = { type?: string; id?: string; name?: string; tool_use_id?: string }

function blocksOf(entry: TranscriptEntry): Block[] {
  const content = (entry.message as { message?: { content?: unknown } } | null)?.message?.content
  return Array.isArray(content) ? (content as Block[]) : []
}

/** `mcp__server__tool` reads as the tool alone; the server is not the point. */
function shortToolName(name: string): string {
  const parts = name.split('__')
  return parts.length >= 3 && parts[0] === 'mcp' ? parts.slice(2).join('__') : name
}

/**
 * The tool whose result the agent is waiting on, within the current turn.
 *
 * Reads the live entries back to the last prompt: every `tool_use` id that
 * has no `tool_result` after it is in flight, and the most recent of those
 * is what the user would want named. Null when the model is thinking or
 * writing.
 */
export function runningTool(entries: TranscriptEntry[]): string | null {
  const resolved = new Set<string>()
  let pending: string | null = null

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (isPrompt(entry)) break
    const blocks = blocksOf(entry)
    for (const block of blocks) {
      if (block.type === 'tool_result' && block.tool_use_id) resolved.add(block.tool_use_id)
    }
    // Walk this message's tool calls last-to-first so the newest unresolved
    // one wins, but only once its later results have been seen above.
    for (let j = blocks.length - 1; j >= 0 && pending === null; j -= 1) {
      const block = blocks[j]
      if (block.type === 'tool_use' && block.id && block.name && !resolved.has(block.id)) {
        pending = shortToolName(block.name)
      }
    }
    if (pending !== null) break
  }

  return pending
}
