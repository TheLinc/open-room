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
  if (type === 'user' && isCommandEcho(entry)) return false
  return !SILENT_TYPES.has(type)
}

/**
 * Whether a `user` entry is the CLI echoing a command back at us.
 *
 * Changing the model mid-session produces two of these, and they arrive by
 * different routes. Live, `setModel` emits
 * `<local-command-stdout>Set model to claude-sonnet-5</local-command-stdout>`
 * as user content. On resume, the persisted session also carries the
 * invocation as a `<command-name>/model</command-name>` block. Both would
 * otherwise render as XML fragments nobody typed — the second only after a
 * restart, which is how it survived the first fix.
 *
 * Matched on the wrapper rather than on `isReplay`, which is also set for
 * genuine replayed input. The content must be *entirely* these tags: a
 * person who types one has still said it, and should see what they sent.
 */
export function isCommandEcho(entry: TranscriptEntry): boolean {
  const content = (entry.message as { message?: { content?: unknown } } | null)?.message?.content
  if (typeof content !== 'string') return false
  return COMMAND_ECHO.test(content.trim())
}

const COMMAND_ECHO = /^(?:\s*<(?:local-)?command-[a-z]+>[\s\S]*?<\/(?:local-)?command-[a-z]+>\s*)+$/

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
