/**
 * Turning a microphone level into something a person can act on.
 *
 * The question this answers is not "how loud is it" but "am I set to the
 * device I am actually talking into" — a machine routinely has three inputs
 * and the system default is frequently not the right one. So the bar exists
 * to be watched for a second or two while you say something, and the verdict
 * exists to say out loud what the bar implies.
 *
 * Kept separate from the microphone, the IPC and the component for the usual
 * reason: none of those are testable where they live, and this is the part
 * with judgement in it.
 */

/** Below this, the bar is empty. Quieter than any room that has a mic open. */
export const METER_MIN_DB = -60

/** At this and above, the bar is full. Short of 0 dB, which only clipping reaches. */
export const METER_MAX_DB = -6

/**
 * The level a signal must reach to count as "this device can hear you".
 *
 * Set between a live-but-quiet room and quiet speech. Too low and an open
 * microphone in a silent room reports success, which is the exact false
 * confirmation the meter exists to prevent.
 */
export const HEARING_LEVEL = 0.25

/** How long to listen before concluding a microphone is deaf. */
export const METER_SETTLE_MS = 1500

export type MeterVerdict =
  /** Too early to say — nobody speaks the instant they press a button. */
  | 'waiting'
  /** Something well above room tone arrived. The device works. */
  | 'hearing'
  /** Long enough with nothing but room tone. Probably the wrong device. */
  | 'silent'

/**
 * An RMS reading as a 0–1 bar position.
 *
 * Logarithmic, because loudness is. Speech RMS runs about 0.05–0.3 against a
 * full scale of 1, so a linear bar would leave a perfectly good microphone
 * twitching in its bottom third and looking broken.
 */
export function meterLevel(rms: number): number {
  if (!(rms > 0)) return 0

  const db = 20 * Math.log10(rms)
  const level = (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)

  return Math.min(1, Math.max(0, level))
}

/**
 * What to tell the user, given the loudest thing heard so far.
 *
 * Takes the peak rather than the current level, and never returns to `silent`
 * once it has said `hearing`: the question is whether this device ever picked
 * you up, so flipping back during the pause between two words would answer a
 * question nobody asked.
 */
export function meterVerdict(peakLevel: number, elapsedMs: number): MeterVerdict {
  if (peakLevel >= HEARING_LEVEL) return 'hearing'
  return elapsedMs < METER_SETTLE_MS ? 'waiting' : 'silent'
}
