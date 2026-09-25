import { describe, expect, it } from 'vitest'
import { DEFAULT_SEGMENTER, Segmenter, type SegmenterVerdict } from './segmenter'

const QUIET = 0.002
const LOUD = 0.2
const FRAME_MS = 16

/**
 * Feeds frames and returns every verdict that was not `listening`, so tests
 * read as "what did it decide" rather than as a wall of no-ops.
 */
function run(
  segmenter: Segmenter,
  steps: { level: number; ms: number }[],
  // The clock never resets: a segmenter listens continuously, so a test that
  // replayed from zero would land back inside the floor-sampling window.
  from = 0
): { decisions: { verdict: SegmenterVerdict; at: number }[]; now: number } {
  const decisions: { verdict: SegmenterVerdict; at: number }[] = []
  let now = from

  for (const step of steps) {
    const until = now + step.ms
    for (; now < until; now += FRAME_MS) {
      const verdict = segmenter.push(step.level, now)
      if (verdict !== 'listening') decisions.push({ verdict, at: now })
    }
  }

  return { decisions, now }
}

/** Long enough to establish the noise floor, quiet throughout. */
const settle = { level: QUIET, ms: DEFAULT_SEGMENTER.floorSampleMs + 100 }

describe('Segmenter', () => {
  it('closes a segment once speech stops', () => {
    const { decisions } = run(new Segmenter(), [
      settle,
      { level: LOUD, ms: 1000 },
      { level: QUIET, ms: 1000 }
    ])

    expect(decisions.filter((d) => d.verdict === 'segment')).toHaveLength(1)
  })

  it('waits out a pause rather than cutting mid-sentence', () => {
    // A gap shorter than the hang time is someone drawing breath.
    const { decisions } = run(new Segmenter(), [
      settle,
      { level: LOUD, ms: 600 },
      { level: QUIET, ms: DEFAULT_SEGMENTER.hangMs - 200 },
      { level: LOUD, ms: 600 },
      { level: QUIET, ms: 1000 }
    ])

    expect(decisions.filter((d) => d.verdict === 'segment')).toHaveLength(1)
  })

  it('cuts a segment that runs too long', () => {
    const { decisions } = run(new Segmenter(), [
      settle,
      { level: LOUD, ms: DEFAULT_SEGMENTER.maxSegmentMs + 500 }
    ])

    expect(decisions.some((d) => d.verdict === 'segment')).toBe(true)
  })

  it('discards the buffer in a quiet room rather than accumulating forever', () => {
    const { decisions } = run(new Segmenter(), [settle, { level: QUIET, ms: 10_000 }])

    expect(decisions.every((d) => d.verdict === 'discard')).toBe(true)
    expect(decisions.length).toBeGreaterThanOrEqual(2)
  })

  it('never reports speech while sampling the room', () => {
    // Speech during the floor window raises the floor; it must not also
    // open a segment on audio the gate has not calibrated against.
    const segmenter = new Segmenter()
    const { decisions } = run(segmenter, [
      { level: LOUD, ms: DEFAULT_SEGMENTER.floorSampleMs - 50 }
    ])

    expect(decisions).toEqual([])
    expect(segmenter.isSpeaking).toBe(false)
  })

  it('is not fooled by a loud room, because the floor is relative', () => {
    // Everything is loud, so nothing stands out as speech.
    const segmenter = new Segmenter()
    const { decisions } = run(segmenter, [
      { level: LOUD, ms: DEFAULT_SEGMENTER.floorSampleMs + 100 },
      { level: LOUD, ms: 3000 }
    ])

    expect(decisions.some((d) => d.verdict === 'segment')).toBe(false)
  })

  it('reports whether someone is currently talking', () => {
    const segmenter = new Segmenter()

    const settled = run(segmenter, [settle])
    expect(segmenter.isSpeaking).toBe(false)

    run(segmenter, [{ level: LOUD, ms: 200 }], settled.now)
    expect(segmenter.isSpeaking).toBe(true)
  })

  it('keeps segmenting after the first segment', () => {
    // Continuous listening, not one capture: the gate has to rearm.
    const { decisions } = run(new Segmenter(), [
      settle,
      { level: LOUD, ms: 500 },
      { level: QUIET, ms: 1200 },
      { level: LOUD, ms: 500 },
      { level: QUIET, ms: 1200 }
    ])

    expect(decisions.filter((d) => d.verdict === 'segment')).toHaveLength(2)
  })

  it('follows a room that gets louder, so noise stops holding a segment open', () => {
    const segmenter = new Segmenter()
    const hum = QUIET * 10
    const settled = run(segmenter, [settle])
    // A fan comes on: at first it reads as speech, then the floor catches up.
    const fan = run(segmenter, [{ level: hum, ms: 20_000 }], settled.now)
    const lastSegment = Math.max(
      ...fan.decisions.filter((d) => d.verdict === 'segment').map((d) => d.at)
    )
    expect(lastSegment - settled.now).toBeLessThan(DEFAULT_SEGMENTER.maxSegmentMs)
    expect(segmenter.isSpeaking).toBe(false)

    // A voice over the fan still opens and closes a segment.
    const { decisions } = run(
      segmenter,
      [
        { level: LOUD, ms: 800 },
        { level: hum, ms: DEFAULT_SEGMENTER.hangMs + 100 }
      ],
      fan.now
    )
    expect(decisions.some((d) => d.verdict === 'segment')).toBe(true)
  })

  it('follows a room that gets quieter, so a floor set in noise does not stay deaf', () => {
    const segmenter = new Segmenter()
    const noisy = QUIET * 30
    // Listening starts in a noisy room, then the noise stops.
    const settled = run(segmenter, [
      { level: noisy, ms: 3000 },
      { level: QUIET, ms: DEFAULT_SEGMENTER.floorWindowMs + 500 }
    ])
    // A soft voice, well under three times the old floor.
    const { decisions } = run(
      segmenter,
      [
        { level: noisy * 2, ms: 800 },
        { level: QUIET, ms: DEFAULT_SEGMENTER.hangMs + 100 }
      ],
      settled.now
    )
    expect(decisions.some((d) => d.verdict === 'segment')).toBe(true)
  })
})
