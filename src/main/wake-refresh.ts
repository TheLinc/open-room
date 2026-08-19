/**
 * Whether always-on listening should be running, and on what.
 *
 * Lifted out of `refreshWake` in the composition root. `index.ts` calls
 * `app.whenReady()` at module scope, so nothing in it can be imported by a
 * test — which is how the device-change bug below sat there unguarded.
 */

export type WakeInput = {
  /** The user's wake-word setting. */
  enabled: boolean
  /** Whether the speech model is on disk. */
  modelInstalled: boolean
  /** Whether the listener is running right now. */
  listening: boolean
  /** Whether the selected microphone differs from the running stream's. */
  deviceChanged: boolean
}

export type WakeAction =
  /** Begin listening. */
  | 'start'
  /** Stop listening. */
  | 'stop'
  /** Stop and begin again, to pick up a different microphone. */
  | 'restart'
  /** Already in the right state. */
  | 'none'

export function wakeAction({
  enabled,
  modelInstalled,
  listening,
  deviceChanged
}: WakeInput): WakeAction {
  // Gated on the model as well as the flag: wake words with nothing to
  // transcribe would hold the microphone open for no reason at all.
  const wanted = enabled && modelInstalled

  if (!wanted) return listening ? 'stop' : 'none'
  if (!listening) return 'start'

  // A device id only applies to the next stream opened, never to one already
  // running. Without this the listener goes on hearing the old microphone
  // while the settings meter, which does reopen, reports the new one working.
  return deviceChanged ? 'restart' : 'none'
}
