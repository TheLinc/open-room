/**
 * What compaction does to the message stream, measured on SDK 0.3.233.
 *
 * A manual `/compact` emits `status: "compacting"`, a `compact_boundary`,
 * and then two things the transcript has to be careful with: the summary
 * arrives as a *user* message flagged `isSynthetic`, and the messages the
 * CLI preserved across the boundary are re-emitted with their original
 * uuids. Rendered naively, the summary reads as something the user typed
 * and the preserved messages appear twice.
 */

/** The compaction summary, injected as a user message nobody typed. */
export function isInjectedSummary(message: unknown): boolean {
  const m = message as { type?: string; isSynthetic?: boolean } | null
  return m?.type === 'user' && m.isSynthetic === true
}

/**
 * The identity a conversation message keeps across a replay, or null for
 * messages that are not part of the record (status, results, quota events).
 * A message seen twice under the same key is the CLI replaying it.
 */
export function replayKey(message: unknown): string | null {
  const m = message as { type?: string; uuid?: string } | null
  if (!m || (m.type !== 'assistant' && m.type !== 'user')) return null
  return typeof m.uuid === 'string' ? m.uuid : null
}
