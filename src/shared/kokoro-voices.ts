/**
 * The Kokoro voice roster.
 *
 * Kept here rather than read from the model so the editor can list voices
 * before the model is downloaded — otherwise choosing a voice would require
 * fetching 163 MB first.
 *
 * Grades are Kokoro's own quality ratings, and they are worth showing: the
 * roster ranges from A to F, and several voices are genuinely poor. Surfacing
 * the grade is what stops someone picking `am_adam` (F+) and concluding the
 * whole engine sounds bad.
 */

export type KokoroVoice = {
  id: string
  name: string
  locale: 'en-us' | 'en-gb'
  gender: 'Female' | 'Male'
  /** Kokoro's own grade, A (best) through F. */
  grade: string
}

export const KOKORO_VOICES: KokoroVoice[] = [
  { id: 'af_heart', name: 'Heart', locale: 'en-us', gender: 'Female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', locale: 'en-us', gender: 'Female', grade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', locale: 'en-us', gender: 'Female', grade: 'B-' },
  { id: 'bf_emma', name: 'Emma', locale: 'en-gb', gender: 'Female', grade: 'B-' },
  { id: 'af_aoede', name: 'Aoede', locale: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_kore', name: 'Kore', locale: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_sarah', name: 'Sarah', locale: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'am_fenrir', name: 'Fenrir', locale: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_michael', name: 'Michael', locale: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', locale: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'af_alloy', name: 'Alloy', locale: 'en-us', gender: 'Female', grade: 'C' },
  { id: 'af_nova', name: 'Nova', locale: 'en-us', gender: 'Female', grade: 'C' },
  { id: 'bf_isabella', name: 'Isabella', locale: 'en-gb', gender: 'Female', grade: 'C' },
  { id: 'bm_george', name: 'George', locale: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'bm_fable', name: 'Fable', locale: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'af_sky', name: 'Sky', locale: 'en-us', gender: 'Female', grade: 'C-' },
  { id: 'bm_lewis', name: 'Lewis', locale: 'en-gb', gender: 'Male', grade: 'D+' },
  { id: 'af_jessica', name: 'Jessica', locale: 'en-us', gender: 'Female', grade: 'D' },
  { id: 'af_river', name: 'River', locale: 'en-us', gender: 'Female', grade: 'D' },
  { id: 'am_echo', name: 'Echo', locale: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', locale: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_liam', name: 'Liam', locale: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_onyx', name: 'Onyx', locale: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'bf_alice', name: 'Alice', locale: 'en-gb', gender: 'Female', grade: 'D' },
  { id: 'bf_lily', name: 'Lily', locale: 'en-gb', gender: 'Female', grade: 'D' },
  { id: 'bm_daniel', name: 'Daniel', locale: 'en-gb', gender: 'Male', grade: 'D' },
  { id: 'am_santa', name: 'Santa', locale: 'en-us', gender: 'Male', grade: 'D-' },
  { id: 'am_adam', name: 'Adam', locale: 'en-us', gender: 'Male', grade: 'F+' }
]

/** Default for a new speaking agent: the only A-grade voice. */
export const DEFAULT_KOKORO_VOICE = 'af_heart'

export function findKokoroVoice(id: string): KokoroVoice | undefined {
  return KOKORO_VOICES.find((voice) => voice.id === id)
}

/**
 * Voices worth offering first. Everything below C is still selectable, but
 * burying it stops the roster's weakest entries defining the impression.
 */
export function recommendedKokoroVoices(): KokoroVoice[] {
  return KOKORO_VOICES.filter((voice) => /^[AB]/.test(voice.grade) || voice.grade === 'C+')
}
