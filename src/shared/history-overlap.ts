import type { TranscriptEntry } from './agent-runtime'
import { replayKey } from './compaction'
import { isPrompt } from './files-changed'

/**
 * Where persisted history and the live transcript overlap.
 *
 * The pane renders history read from disk, then a "Resumed" divider, then
 * the entries streamed during this app session. History is re-read every
 * time the pane mounts — it is keyed by agent, so every sidebar switch —
 * while live entries are kept per agent across switches. After any live
 * turn, the disk copy therefore already contains what the live list still
 * holds, and rendering both showed the turn twice under a divider claiming
 * the conversation had been resumed from somewhere.
 *
 * This trims history to what the live list does not cover. Assistant
 * messages match by uuid, which the CLI preserves on disk. The prompt that
 * opens a turn cannot: the supervisor emits the user's message itself
 * (the SDK does not echo input) and it has no uuid, so it is recognised
 * positionally — as the persisted prompt immediately before the first
 * matched reply, or, for a prompt sent moments ago with no reply yet, as
 * the last persisted entry with the same text.
 */
export function trimOverlap(
  history: TranscriptEntry[],
  live: TranscriptEntry[]
): TranscriptEntry[] {
  if (live.length === 0 || history.length === 0) return history

  const byKey = new Map<string, number>()
  history.forEach((entry, i) => {
    const key = replayKey(entry.message)
    if (key) byKey.set(key, i)
  })

  let cut = -1
  for (const entry of live) {
    const key = replayKey(entry.message)
    if (key && byKey.has(key)) {
      cut = byKey.get(key)!
      break
    }
  }

  const first = live[0]
  const liveOpensWithPrompt = isPrompt(first) && replayKey(first.message) === null

  if (cut === -1) {
    // Nothing keyed matched. The only overlap still possible is a prompt the
    // CLI has written to disk before replying to it.
    const last = history.length - 1
    if (
      liveOpensWithPrompt &&
      isPrompt(history[last]) &&
      promptText(history[last]) === promptText(first)
    ) {
      return history.slice(0, last)
    }
    return history
  }

  if (liveOpensWithPrompt && cut > 0 && isPrompt(history[cut - 1])) cut -= 1
  return history.slice(0, cut)
}

/** The typed text of a prompt, whether stored as a string or as blocks. */
function promptText(entry: TranscriptEntry): string {
  const m = entry.message as { message?: { content?: unknown } }
  const content = m.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('\n')
}
