import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INTERRUPT_GRACE_MS,
  pumpFailureIsFault,
  settledWithin,
  stopNeedsInterrupt
} from './stop-plan'

describe('settledWithin', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports settled when the promise resolves inside the window', async () => {
    let resolve!: () => void
    const p = new Promise<void>((r) => (resolve = r))
    const outcome = settledWithin(p, 1000)
    await vi.advanceTimersByTimeAsync(200)
    resolve()
    await expect(outcome).resolves.toBe('settled')
  })

  it('reports timeout when the window closes first, so the caller can escalate', async () => {
    const never = new Promise<void>(() => {})
    const outcome = settledWithin(never, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(outcome).resolves.toBe('timeout')
  })

  it('treats a rejection as settled, since the wait is over either way', async () => {
    const outcome = settledWithin(Promise.reject(new Error('x')), 1000)
    await expect(outcome).resolves.toBe('settled')
  })

  it('gives an acknowledged interrupt a few seconds before the process is closed', () => {
    expect(INTERRUPT_GRACE_MS).toBeGreaterThanOrEqual(3000)
    expect(INTERRUPT_GRACE_MS).toBeLessThanOrEqual(10000)
  })
})

describe('pumpFailureIsFault', () => {
  it('reports a stream that throws while the session is running', () => {
    expect(pumpFailureIsFault({ stopping: false })).toBe(true)
  })

  it('ignores a stream that throws while stop() is closing it, since the SDK re-raises an interrupted turn there', () => {
    expect(pumpFailureIsFault({ stopping: true })).toBe(false)
  })
})

describe('stopNeedsInterrupt', () => {
  it('interrupts a working agent, since closing its input alone waits for the turn to finish', () => {
    expect(stopNeedsInterrupt('working')).toBe(true)
  })

  it('interrupts a starting agent, whose first prompt is already in flight', () => {
    expect(stopNeedsInterrupt('starting')).toBe(true)
  })

  it('closes a ready or errored session without an interrupt, there being no turn to end', () => {
    expect(stopNeedsInterrupt('ready')).toBe(false)
    expect(stopNeedsInterrupt('error')).toBe(false)
  })

  it('has nothing to interrupt for an idle agent', () => {
    expect(stopNeedsInterrupt('idle')).toBe(false)
  })
})
