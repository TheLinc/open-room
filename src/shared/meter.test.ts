import { describe, expect, it } from 'vitest'
import {
  HEARING_LEVEL,
  METER_SETTLE_MS,
  METER_MAX_DB,
  METER_MIN_DB,
  meterLevel,
  meterVerdict
} from './meter'

/** Typical RMS readings, from the levels the wake listener logs in a real room. */
const ROOM_TONE = 0.0005
const LIVE_BUT_QUIET = 0.002
const QUIET_SPEECH = 0.01
const SPEECH = 0.15

describe('meterLevel', () => {
  it('is silent for a dead microphone', () => {
    expect(meterLevel(0)).toBe(0)
  })

  it('puts speech in the upper half of the bar', () => {
    // The reason this is not linear. Speech RMS runs about 0.05–0.3, so a
    // linear bar leaves a perfectly good microphone looking broken.
    expect(meterLevel(SPEECH)).toBeGreaterThan(0.5)
  })

  it('separates speech from a live but quiet room', () => {
    expect(meterLevel(SPEECH) - meterLevel(LIVE_BUT_QUIET)).toBeGreaterThan(0.5)
  })

  it('leaves room tone near the bottom without pinning it to zero', () => {
    // Some movement matters: a bar that is identically zero cannot be told
    // apart from a microphone that is not open at all.
    expect(meterLevel(ROOM_TONE)).toBeLessThan(0.1)
  })

  it('clamps a full-scale signal to the top', () => {
    expect(meterLevel(1)).toBe(1)
    expect(meterLevel(4)).toBe(1)
  })

  it('never returns a negative level', () => {
    expect(meterLevel(-0.5)).toBe(0)
  })

  it('rises monotonically with input', () => {
    const levels = [ROOM_TONE, LIVE_BUT_QUIET, QUIET_SPEECH, SPEECH].map(meterLevel)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1])
  })

  it('maps the configured decibel range onto the full bar', () => {
    expect(meterLevel(10 ** (METER_MIN_DB / 20))).toBeCloseTo(0, 5)
    expect(meterLevel(10 ** (METER_MAX_DB / 20))).toBeCloseTo(1, 5)
  })
})

describe('meterVerdict', () => {
  it('waits before accusing a microphone of silence', () => {
    // Nobody speaks the instant they press a button.
    expect(meterVerdict(0, 100)).toBe('waiting')
  })

  it('reports silence once the grace period has passed', () => {
    expect(meterVerdict(0, METER_SETTLE_MS + 1)).toBe('silent')
  })

  it('reports hearing as soon as something clears the threshold', () => {
    expect(meterVerdict(HEARING_LEVEL, 50)).toBe('hearing')
  })

  it('stays hearing afterwards, because the answer is already known', () => {
    // The question is "did this device ever pick me up", so the verdict must
    // not flip back to silent in the pause between words.
    expect(meterVerdict(HEARING_LEVEL, 60_000)).toBe('hearing')
  })

  it('does not count room tone as hearing', () => {
    expect(meterVerdict(meterLevel(ROOM_TONE), METER_SETTLE_MS + 1)).toBe('silent')
    expect(meterVerdict(meterLevel(LIVE_BUT_QUIET), METER_SETTLE_MS + 1)).toBe('silent')
  })

  it('counts even quiet speech as hearing', () => {
    expect(meterVerdict(meterLevel(QUIET_SPEECH), METER_SETTLE_MS + 1)).toBe('hearing')
  })
})
