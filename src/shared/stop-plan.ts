import type { AgentState } from './agent-runtime'

/**
 * Whether ending a session has to interrupt the turn in flight first.
 *
 * Closing the input generator only tells the CLI there will be no more
 * prompts; it finishes the current turn before it exits. Measured on a
 * 1500-word essay: Stop pressed 8 s in, the agent stayed `working` for
 * another 18 s until the essay was complete, and only then went idle. So a
 * turn that is running, or a first prompt still spawning, is interrupted
 * before the stream is closed. A session merely waiting for input has
 * nothing to interrupt, and an interrupt there would race the CLI for no
 * gain.
 */
export function stopNeedsInterrupt(state: AgentState): boolean {
  return state === 'working' || state === 'starting'
}

/**
 * How long an acknowledged interrupt gets to actually end the turn.
 *
 * `query.interrupt()` resolves when the CLI acknowledges, not when the turn
 * ends, and a background task the CLI resumed can keep it running after the
 * acknowledgement (T3 Code's Claude adapter records the same finding and
 * kills the process outright for it). Past this window the process is closed
 * instead, which the SDK escalates from SIGTERM to SIGKILL.
 */
export const INTERRUPT_GRACE_MS = 5000

/**
 * Waits for a promise, but not forever: `'timeout'` is the signal to
 * escalate. A rejection counts as settled, since the wait is over either way
 * and the failure is reported wherever the promise is consumed.
 */
export function settledWithin(
  promise: Promise<unknown>,
  ms: number
): Promise<'settled' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms)
    const settle = (): void => {
      clearTimeout(timer)
      resolve('settled')
    }
    promise.then(settle, settle)
  })
}

/**
 * Whether the message stream throwing is something to show the user.
 *
 * Measured: closing a session whose last turn was interrupted makes the SDK
 * re-raise that turn's error result as "Claude Code returned an error
 * result: [ede_diagnostic] ...", and it used to land on the runtime as a
 * `crashed` error on an idle agent, so a plain Stop after an Interrupt read
 * as a crash. A stream that fails while `stop()` is closing it deliberately
 * is not a fault; one that fails on its own still is.
 */
export function pumpFailureIsFault(session: { stopping: boolean }): boolean {
  return !session.stopping
}
