/**
 * What the tray's voice item means, now that push-to-talk and wake words
 * are independent opt-ins.
 *
 * Off is the panic direction and must be total: one gesture guarantees the
 * microphone is closed, whichever path had it open. On restores only
 * push-to-talk — re-arming an always-open microphone from a tray click
 * would silently recreate the exact channel wake words make people opt
 * into deliberately, so wake comes back in settings or not at all.
 */

export type VoicePaths = {
  voiceInputEnabled: boolean
  wakeWordEnabled: boolean
}

/** Whether any voice path is on — what the tray checkbox shows. */
export function voiceActive(paths: VoicePaths): boolean {
  return paths.voiceInputEnabled || paths.wakeWordEnabled
}

export function trayVoiceToggle(paths: VoicePaths): { next: VoicePaths; enabling: boolean } {
  if (voiceActive(paths)) {
    return { next: { voiceInputEnabled: false, wakeWordEnabled: false }, enabling: false }
  }
  return { next: { voiceInputEnabled: true, wakeWordEnabled: false }, enabling: true }
}
