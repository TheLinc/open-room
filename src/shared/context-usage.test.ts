import { describe, expect, it } from 'vitest'
import {
  contextSeverity,
  contextUsageFrom,
  contextWindowFor,
  describeContext,
  promptTokens
} from './context-usage'

/**
 * The figures here are taken from a real session rather than invented: a
 * fresh conversation on claude-haiku-4-5 occupied ~37.5K of a 200K window,
 * and grew by roughly a hundred tokens a turn.
 */

const realUsage = {
  input_tokens: 10,
  cache_read_input_tokens: 37475,
  cache_creation_input_tokens: 143,
  output_tokens: 110
}

const realModelUsage = {
  'claude-haiku-4-5': {
    inputTokens: 30,
    cacheReadInputTokens: 74901,
    contextWindow: 200000
  }
}

describe('promptTokens', () => {
  it('counts the whole prompt, cache included', () => {
    // Cache reads dominate once a conversation is warm. Counting only
    // input_tokens reports 10 tokens for a 37,628-token prompt.
    expect(promptTokens(realUsage)).toBe(37628)
  })

  it('is zero when there is nothing to measure', () => {
    expect(promptTokens(null)).toBe(0)
    expect(promptTokens({})).toBe(0)
  })
})

describe('contextWindowFor', () => {
  it('reads the window off the model that ran the turn', () => {
    expect(contextWindowFor(realModelUsage, 'claude-haiku-4-5')).toBe(200000)
  })

  it('prefers the agent\u2019s own model when several are present', () => {
    // Subagent and internal calls land in modelUsage too, so key order is
    // not a safe way to pick.
    const mixed = {
      'claude-haiku-4-5': { contextWindow: 200000 },
      'claude-opus-5': { contextWindow: 500000 }
    }
    expect(contextWindowFor(mixed, 'claude-haiku-4-5')).toBe(200000)
  })

  it('falls back to the largest window rather than the first key', () => {
    const mixed = {
      'claude-haiku-4-5': { contextWindow: 200000 },
      'claude-opus-5': { contextWindow: 500000 }
    }
    expect(contextWindowFor(mixed, undefined)).toBe(500000)
    expect(contextWindowFor(mixed, 'not-in-the-map')).toBe(500000)
  })

  it('is zero when nothing reports a window', () => {
    expect(contextWindowFor(null)).toBe(0)
    expect(contextWindowFor({ 'claude-haiku-4-5': { contextWindow: 0 } })).toBe(0)
  })
})

describe('contextUsageFrom', () => {
  it('measures a real turn', () => {
    const usage = contextUsageFrom(realUsage, realModelUsage, 'claude-haiku-4-5')

    expect(usage).not.toBeNull()
    expect(usage?.usedTokens).toBe(37628)
    expect(usage?.windowTokens).toBe(200000)
    expect(usage?.fraction).toBeCloseTo(0.188, 3)
  })

  it('is null when either half is missing', () => {
    // A crash or startup-error result can carry zeroed usage; showing 0% for
    // a conversation that is actually full would be worse than showing none.
    expect(contextUsageFrom(realUsage, null)).toBeNull()
    expect(contextUsageFrom(null, realModelUsage)).toBeNull()
    expect(contextUsageFrom({}, realModelUsage)).toBeNull()
  })

  it('does not clamp above the window, because over-limit is real', () => {
    const over = contextUsageFrom(
      { cache_read_input_tokens: 220000 },
      realModelUsage,
      'claude-haiku-4-5'
    )
    expect(over?.fraction).toBeCloseTo(1.1, 3)
  })
})

describe('contextSeverity', () => {
  const at = (fraction: number) => ({ usedTokens: 0, windowTokens: 100, fraction })

  it('stays quiet through the ordinary range', () => {
    expect(contextSeverity(at(0.19))).toBe('ok')
    expect(contextSeverity(at(0.69))).toBe('ok')
    expect(contextSeverity(null)).toBe('ok')
  })

  it('warns before it bites, and escalates before compaction', () => {
    expect(contextSeverity(at(0.7))).toBe('warn')
    expect(contextSeverity(at(0.89))).toBe('warn')
    expect(contextSeverity(at(0.9))).toBe('high')
    expect(contextSeverity(at(1.4))).toBe('high')
  })
})

describe('describeContext', () => {
  it('fits a pane header', () => {
    expect(describeContext({ usedTokens: 37628, windowTokens: 200000, fraction: 0.188 })).toBe(
      '19% of 200K'
    )
  })

  it('says nothing when there is nothing to say', () => {
    expect(describeContext(null)).toBeNull()
  })
})
