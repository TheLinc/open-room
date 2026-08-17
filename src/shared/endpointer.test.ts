import { describe, expect, it } from 'vitest'
import { DEFAULT_ENDPOINTER, Endpointer, rmsOf, type EndpointerVerdict } from './endpointer'

/** Feeds frames at 50ms intervals, returning every verdict produced. */
function feed(endpointer: Endpointer, levels: number[], stepMs = 50): EndpointerVerdict[] {
  return levels.map((rms, i) => endpointer.push(rms, i * stepMs))
}

/** 300ms of room tone at the given level, which sets the noise floor. */
const floor = (level: number): number[] => new Array(6).fill(level)

describe('rmsOf', () => {
  it('is zero for silence and one for a full-scale square wave', () => {
    expect(rmsOf(new Float32Array([0, 0, 0, 0]))).toBe(0)
    expect(rmsOf(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1)
  })

  it('is zero for an empty frame rather than NaN', () => {
    expect(rmsOf(new Float32Array(0))).toBe(0)
  })
})

describe('Endpointer', () => {
  it('does not end on the silence before speech starts', () => {
    // Four seconds of quiet — well past the 1.5s hang time.
    expect(feed(new Endpointer(), new Array(80).fill(0.001))).not.toContain('ended-silence')
  })

  it('cancels when no speech arrives within the no-speech timeout', () => {
    expect(feed(new Endpointer(), new Array(120).fill(0.001))).toContain('cancelled-no-speech')
  })

  it('reports speech starting once the level clears the noise floor', () => {
    expect(feed(new Endpointer(), [...floor(0.01), 0.4, 0.5])).toContain('speech-started')
  })

  it('reports speech starting only once', () => {
    const verdicts = feed(new Endpointer(), [...floor(0.01), ...new Array(10).fill(0.5)])

    expect(verdicts.filter((v) => v === 'speech-started')).toHaveLength(1)
  })

  it('ends after the hang time once speech stops', () => {
    const verdicts = feed(new Endpointer(), [
      ...floor(0.01),
      ...new Array(10).fill(0.5),
      ...new Array(31).fill(0.01)
    ])

    expect(verdicts).toContain('ended-silence')
  })

  it('does not end on a pause shorter than the hang time', () => {
    const verdicts = feed(new Endpointer(), [
      ...floor(0.01),
      ...new Array(10).fill(0.5),
      ...new Array(20).fill(0.01), // 1s pause — mid-sentence
      ...new Array(10).fill(0.5)
    ])

    expect(verdicts).not.toContain('ended-silence')
  })

  it('ends at the hard cap even while speech continues', () => {
    const frames = DEFAULT_ENDPOINTER.maxDurationMs / 50 + 4

    expect(feed(new Endpointer(), [...floor(0.01), ...new Array(frames).fill(0.5)])).toContain(
      'ended-max-duration'
    )
  })

  it('cancels a capture whose noise floor was polluted by speech', () => {
    // Talking through the floor window raises the threshold above the voice
    // that set it, so nothing ever reads as speech. Cancelling after the
    // no-speech timeout is the right outcome: better a capture that gives up
    // than one that records the room for thirty seconds.
    const frames = DEFAULT_ENDPOINTER.noSpeechTimeoutMs / 50 + 4

    expect(feed(new Endpointer(), new Array(frames).fill(0.5))).toContain('cancelled-no-speech')
  })

  it('adapts to a noisy room rather than using a fixed threshold', () => {
    // A room whose floor is 0.1 must not treat 0.1 as speech.
    const verdicts = feed(new Endpointer(), [...floor(0.1), ...new Array(10).fill(0.1)])

    expect(verdicts).not.toContain('speech-started')
  })

  it('still detects speech in a noisy room when it is loud enough', () => {
    const verdicts = feed(new Endpointer(), [...floor(0.1), ...new Array(10).fill(0.5)])

    expect(verdicts).toContain('speech-started')
  })

  it('does not go deaf in a silent room', () => {
    // A perfectly quiet floor would give a zero threshold that every frame
    // clears, so the floor has a minimum.
    const verdicts = feed(new Endpointer(), [...floor(0), ...new Array(10).fill(0.001)])

    expect(verdicts).not.toContain('speech-started')
  })

  it('reports one terminal verdict and then stays quiet', () => {
    const endpointer = new Endpointer()
    const verdicts = feed(endpointer, [
      ...floor(0.01),
      ...new Array(10).fill(0.5),
      ...new Array(60).fill(0.01)
    ])

    expect(verdicts.filter((v) => v !== 'listening' && v !== 'speech-started')).toEqual([
      'ended-silence'
    ])
  })
})
