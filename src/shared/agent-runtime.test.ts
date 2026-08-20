import { describe, expect, it } from 'vitest'
import { emptyRuntime, isTransient } from './agent-runtime'

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
