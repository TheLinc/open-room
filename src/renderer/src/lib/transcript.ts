import type { TranscriptEntry } from '@shared/agent-runtime'

/**
 * Whether an entry produces any visible output.
 *
 * Callers must filter on this rather than relying on the row component
 * returning null: a wrapper element with `contain-intrinsic-size` still
 * reserves its placeholder height, so a run of silent system messages leaves
 * a large blank gap at the top of the transcript.
 *
 * Lives here rather than beside the component so that file exports only
 * components, which is what React Fast Refresh requires.
 */
export function isRenderable(entry: TranscriptEntry): boolean {
  const message = entry.message as { type?: string; subtype?: string } | null
  const type = message?.type
  if (type === undefined) return false
  if (type === 'system') return VISIBLE_SYSTEM_SUBTYPES.has(message?.subtype ?? '')
  return !SILENT_TYPES.has(type)
}

/**
 * System messages that do carry something worth a row.
 *
 * Compaction is the conversation losing its middle. It happens on its own
 * once the window fills, and with everything of type `system` filtered out it
 * happened invisibly — leaving an agent that had demonstrably forgotten
 * things with nothing in the transcript to explain why.
 */
const VISIBLE_SYSTEM_SUBTYPES = new Set(['compact_boundary'])

/**
 * Message types that never produce a row.
 *
 * `AgentSupervisor` appends every SDK message to the transcript before it
 * dispatches on type, so anything the UI consumes as state rather than as
 * content has to be excluded here too. `rate_limit_event` is the one that
 * bit: the SDK emits it once per turn as a routine quota heartbeat, almost
 * always with `status: 'allowed'`, and it was reaching the debug fallthrough
 * in `TranscriptMessage` and rendering as a JSON dump in every chat. It is
 * already surfaced properly on `AgentRuntime.rateLimit` as a banner, so the
 * row was duplicating something that had a better home.
 */
const SILENT_TYPES = new Set(['system', 'stream_event', 'rate_limit_event'])
