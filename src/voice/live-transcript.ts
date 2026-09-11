/**
 * The decisions behind a live transcript, kept pure.
 *
 * Moonshine is an offline model: every partial is a fresh decode of the
 * audio so far. What makes that read as a transcript settling rather than a
 * sentence rewriting itself is the LocalAgreement policy from Whisper
 * Streaming (Macháček et al., 2023): a word is committed once two consecutive
 * decodes agree on it at the same position, and only the tail past the last
 * agreement is shown as tentative. Committed words never uncommit.
 *
 * The cost of a decode grows with the audio, so a long dictation is cut
 * into windows: once the buffer passes `MIN_WINDOW_S`, the quietest stretch
 * outside the last few seconds becomes a cut, everything before it is
 * decoded one last time and sealed, and the buffer starts again from there.
 * The sidecar's session drives this; nothing here touches audio devices or
 * models.
 */

/** Below this the window is decoded whole; above it a cut is looked for. */
export const MIN_WINDOW_S = 12
/** Never cut inside the newest audio: the word being spoken is not finished. */
export const KEEP_TAIL_S = 3
/** The quiet stretch has to be this long to count as a gap between words. */
const GAP_FRAME_S = 0.3
/** With no gap found, cut here rather than let the window grow without bound. */
const FORCED_CUT_S = 10

export type Agreement = { committed: string[]; tentative: string[] }

/** What two decodes have to agree on: the word, not its case or its comma. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
}

export function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/**
 * LocalAgreement over two consecutive decodes.
 *
 * `committedCount` words are already committed and stay so whatever the new
 * decode says about them; the newer decode's spelling is shown for every
 * word, so punctuation that settles later lands without a flicker.
 */
export function agree(previous: string[], current: string[], committedCount: number): Agreement {
  let n = Math.min(committedCount, current.length)
  while (
    n < current.length &&
    n < previous.length &&
    normalizeWord(current[n]) === normalizeWord(previous[n])
  ) {
    n += 1
  }
  return { committed: current.slice(0, n), tentative: current.slice(n) }
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / Math.max(1, end - start))
}

/**
 * Where to cut a window that has grown past `MIN_WINDOW_S`: the centre of
 * the quietest `GAP_FRAME_S` stretch older than `KEEP_TAIL_S`, searched
 * from the middle of the window so the sealed part is worth sealing. Null
 * while the window is short. A window with no quiet in it is cut at
 * `FORCED_CUT_S` anyway: a word split at a forced cut costs one word, and
 * an unbounded window costs every later partial.
 */
export function cutPoint(
  samples: Float32Array,
  options: { sampleRate: number; minWindowS?: number }
): number | null {
  const { sampleRate } = options
  const minWindow = (options.minWindowS ?? MIN_WINDOW_S) * sampleRate
  if (samples.length < minWindow) return null

  const frame = Math.round(GAP_FRAME_S * sampleRate)
  const step = Math.round(0.1 * sampleRate)
  const from = Math.floor(samples.length / 2)
  const to = samples.length - Math.round(KEEP_TAIL_S * sampleRate) - frame

  let best: { at: number; level: number } | null = null
  for (let start = from; start <= to; start += step) {
    const level = rms(samples, start, start + frame)
    if (!best || level < best.level) best = { at: start + Math.floor(frame / 2), level }
  }

  // "Quiet" is relative to the window: a gap has to sit well under the
  // window's own level, or a steady talker would be cut mid-word at
  // whichever frame happened to dip least.
  const overall = rms(samples, 0, samples.length)
  if (best && best.level < overall * 0.35) return best.at
  return Math.min(Math.round(FORCED_CUT_S * sampleRate), to)
}

/**
 * The transcript as it settles: sealed windows, then the words the last
 * two decodes of the open window agreed on, then the tentative tail.
 */
export class LiveTranscript {
  private sealed: string[] = []
  private previous: string[] = []
  private committed: string[] = []
  private tentative: string[] = []

  /** A fresh decode of the open window. */
  apply(current: string[]): void {
    const result = agree(this.previous, current, this.committed.length)
    this.committed = result.committed
    this.tentative = result.tentative
    this.previous = current
  }

  /** The open window was cut and decoded one last time; it is final now. */
  seal(finalWords: string[]): void {
    this.sealed.push(...finalWords)
    this.previous = []
    this.committed = []
    this.tentative = []
  }

  view(): { committed: string; tentative: string } {
    return {
      committed: [...this.sealed, ...this.committed].join(' '),
      tentative: this.tentative.join(' ')
    }
  }

  /** The text to send: every sealed window, then the last decode whole. */
  finish(lastDecode: string): string {
    return [...this.sealed, ...words(lastDecode)].join(' ').trim()
  }
}
