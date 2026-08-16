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
  const type = (entry.message as { type?: string } | null)?.type
  return type !== 'system' && type !== 'stream_event'
}
