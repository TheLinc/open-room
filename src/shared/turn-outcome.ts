/**
 * What a turn's result message actually means.
 *
 * The SDK's result carries two signals that do not agree with each other:
 * `subtype` and `is_error`. Measured on the bundled CLI, a model the
 * account cannot use and an OAuth token that expired and failed to refresh
 * both arrive as `subtype: 'success'` with `is_error: true` and the error
 * sentence in `result`. Reading the subtype alone took that sentence for
 * the agent's reply and spoke it aloud as the closing line.
 *
 * An interrupt the user asked for is also reported as an error result, and
 * is neither a success nor a fault. The supervisor knows it asked; this
 * takes that as an argument so the three-way decision lives in one place.
 */
export type TurnOutcome = 'success' | 'error' | 'interrupted'

export function turnOutcome(
  result: { subtype: string; is_error?: boolean },
  interrupted: boolean
): TurnOutcome {
  if (interrupted) return 'interrupted'
  if (result.is_error || result.subtype !== 'success') return 'error'
  return 'success'
}
