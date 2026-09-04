import { describe, expect, it } from 'vitest'
import { pumpFailureIsFault, stopNeedsInterrupt } from './stop-plan'

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
