import { describe, expect, it } from 'vitest'
import { MIN_SPEECH_MS, VAD_FRAME, acceptsSpeech, frameMs } from './vad'

/**
 * The verdict, without the model.
 *
 * Silero itself needs 2 MB of weights and a native runtime, so the part worth
 * testing here is the judgement made on top of its output: how much speech in
 * a segment is enough to be worth waking Whisper for.
 */

/** How many speech frames a given duration of speech produces. */
const framesFor = (ms: number): number => Math.round(ms / frameMs())

describe('acceptsSpeech', () => {
  it('accepts a short wake phrase buried in padding', () => {
    // The regression this exists for. "Hey Derek" is about 650 ms of voiced
    // audio, and the segmenter wraps every utterance in 500 ms of pre-roll,
    // 700 ms of hang, and up to 3 s of silence accumulated since the last
    // idle flush. Measured against the real model, that segment scored 0.174
    // as a ratio — rejected — while the same speech alone scored 0.435.
    expect(acceptsSpeech(framesFor(650), framesFor(4500))).toBe(true)
  })

  it('rejects a quiet room', () => {
    expect(acceptsSpeech(0, framesFor(3000))).toBe(false)
  })

  it('rejects a single frame crossing the threshold', () => {
    // One frame is what a door closing looks like.
    expect(acceptsSpeech(1, framesFor(3000))).toBe(false)
  })

  it('does not get easier to trigger as the segment gets longer', () => {
    // A ratio does exactly this backwards: the same speech in a longer
    // segment scores lower, so detection depended on how much silence
    // happened to precede it.
    const speech = framesFor(MIN_SPEECH_MS + 100)
    expect(acceptsSpeech(speech, framesFor(2000))).toBe(true)
    expect(acceptsSpeech(speech, framesFor(15_000))).toBe(true)
  })

  it('rejects speech shorter than the minimum', () => {
    expect(acceptsSpeech(framesFor(MIN_SPEECH_MS) - 2, framesFor(2000))).toBe(false)
  })

  it('reports nothing for an empty segment', () => {
    expect(acceptsSpeech(0, 0)).toBe(false)
  })
})

describe('frameMs', () => {
  it('is the duration of one Silero frame at 16 kHz', () => {
    expect(frameMs()).toBeCloseTo((VAD_FRAME / 16000) * 1000, 5)
  })
})
