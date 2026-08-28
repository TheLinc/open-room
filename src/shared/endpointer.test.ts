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
      ...new Array(60).fill(0.01)
    ])

    expect(verdicts).toContain('ended-silence')
  })

  it('does not end on a pause shorter than the hang time', () => {
    // Two seconds — the kind of mid-prompt thinking pause that ended real
    // captures when the hang was 1.5s.
    const verdicts = feed(new Endpointer(), [
      ...floor(0.01),
      ...new Array(10).fill(0.5),
      ...new Array(40).fill(0.01),
      ...new Array(10).fill(0.5)
    ])

    expect(verdicts).not.toContain('ended-silence')
  })

  it('lets a long prompt run for minutes', () => {
    // A user dictating a long prompt was cut off mid-sentence at 30s in the
    // field. The cap is a stuck-microphone failsafe, not a UX bound, so a
    // minute of continuous speech must survive it.
    const frames = 60_000 / 50

    expect(feed(new Endpointer(), [...floor(0.01), ...new Array(frames).fill(0.5)])).not.toContain(
      'ended-max-duration'
    )
  })

  it('ends at the hard cap even while speech continues', () => {
    // Unconditional on purpose: a cap that yields to speech is no failsafe,
    // because the runaway case — a TV keeping the detector loud — is exactly
    // the one that never goes quiet.
    const frames = DEFAULT_ENDPOINTER.maxDurationMs / 50 + 4

    expect(feed(new Endpointer(), [...floor(0.01), ...new Array(frames).fill(0.5)])).toContain(
      'ended-max-duration'
    )
  })

  it('hears speech that starts inside the floor window, after a brief gap', () => {
    // Press, a beat of quiet, then talking before the window closes. The mean
    // of those samples is speech-level and deafened the capture; a low
    // percentile reads the gap instead.
    const verdicts = feed(new Endpointer(), [
      0.01,
      0.01,
      0.5,
      0.5,
      0.5,
      0.5,
      ...new Array(10).fill(0.5)
    ])

    expect(verdicts).toContain('speech-started')
  })

  it('recovers a speech-polluted floor at the first real pause', () => {
    // Talking through the whole floor window sets the threshold above the
    // voice that set it. The floor may ratchet down when a trailing window
    // shows the room is quieter than the floor claimed — so the first
    // between-sentences pause repairs the capture instead of it dying.
    const verdicts = feed(new Endpointer(), [
      ...new Array(6).fill(0.5), // floor window, all speech
      ...new Array(10).fill(0.5), // unheard: below 3x the polluted floor
      ...new Array(24).fill(0.01), // a 1.2s pause between sentences
      ...new Array(10).fill(0.5) // now audible against the repaired floor
    ])

    expect(verdicts).toContain('speech-started')
  })

  it('cancels when a polluted floor never gets a pause to repair itself', () => {
    // A perfectly steady loud level from the first frame is indistinguishable
    // from room noise, so giving up at the no-speech timeout is still right.
    // Real speech modulates; the ratchet test above is the realistic case.
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
