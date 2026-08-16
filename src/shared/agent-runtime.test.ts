import { describe, expect, it } from 'vitest'
import { describeRateLimit, emptyRuntime, isTransient } from './agent-runtime'

describe('emptyRuntime', () => {
  it('starts idle with nothing recorded', () => {
    const runtime = emptyRuntime('atlas')
    expect(runtime.state).toBe('idle')
    expect(runtime.sessionId).toBeNull()
    expect(runtime.error).toBeNull()
    expect(runtime.rateLimit).toBeNull()
    expect(runtime.usage.numTurns).toBe(0)
  })
})

describe('isTransient', () => {
  it('separates conditions that clear themselves from ones that do not', () => {
    expect(isTransient('rate-limited')).toBe(true)
    expect(isTransient('overloaded')).toBe(true)
    expect(isTransient('billing')).toBe(false)
    expect(isTransient('cli-missing')).toBe(false)
  })
})

describe('describeRateLimit', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeRateLimit(null)).toBeNull()
    expect(describeRateLimit({ status: 'allowed' })).toBeNull()
  })

  it('names the window that was hit', () => {
    expect(describeRateLimit({ status: 'rejected', rateLimitType: 'five_hour' })).toContain(
      '5-hour limit'
    )
    expect(describeRateLimit({ status: 'rejected', rateLimitType: 'seven_day' })).toContain(
      'weekly limit'
    )
  })

  it('mentions overage, since the agent keeps working on it', () => {
    const text = describeRateLimit({
      status: 'rejected',
      rateLimitType: 'five_hour',
      isUsingOverage: true
    })
    expect(text).toContain('overage')
  })

  it('warns before the limit with a utilisation percentage', () => {
    const text = describeRateLimit({
      status: 'allowed_warning',
      rateLimitType: 'five_hour',
      utilization: 0.85
    })
    expect(text).toContain('Approaching')
    expect(text).toContain('85%')
  })

  it('falls back to a generic window for unfamiliar types', () => {
    expect(describeRateLimit({ status: 'rejected', rateLimitType: 'something_new' })).toContain(
      'usage limit'
    )
  })
})
