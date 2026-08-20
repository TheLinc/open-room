import { describe, expect, it } from 'vitest'
import { shouldSpeakFallback } from './condense'

/**
 * Every reply an agent leaves silent is spoken for it, so that finishing is
 * always audible. The interesting cases are the ones that must stay quiet:
 * an agent that already spoke, and a turn that did not actually complete.
 */

const turn = {
  ttsEnabled: true,
  alreadySpoke: false,
  succeeded: true,
  interrupted: false
}

describe('shouldSpeakFallback', () => {
  it('speaks an ordinary reply the agent left silent', () => {
    // The case that used to fail: a short turn, under the old 30s bar.
    expect(shouldSpeakFallback(turn)).toBe(true)
  })

  it('stays quiet when the agent already spoke for itself', () => {
    // Its own line is written for the ear and arrives mid-task; condensing a
    // second one after it would just repeat the ending.
    expect(shouldSpeakFallback({ ...turn, alreadySpoke: true })).toBe(false)
  })

  it('stays quiet when the agent has speech switched off', () => {
    expect(shouldSpeakFallback({ ...turn, ttsEnabled: false })).toBe(false)
  })

  it('stays quiet after an interrupt', () => {
    // The user just silenced this agent; announcing a completion would
    // resurrect exactly what they stopped.
    expect(shouldSpeakFallback({ ...turn, interrupted: true })).toBe(false)
  })

  it('stays quiet when the turn did not succeed', () => {
    // A failure is surfaced as an agent state, not as a spoken completion.
    expect(shouldSpeakFallback({ ...turn, succeeded: false })).toBe(false)
  })

  it('does not consider how long the turn took', () => {
    // Guards the removal of the duration gate: a turn's length is a protocol
    // fact about elapsed time, not evidence about whether the work mattered.
    expect(Object.keys(turn)).not.toContain('durationMs')
    expect(shouldSpeakFallback(turn)).toBe(true)
  })
})
