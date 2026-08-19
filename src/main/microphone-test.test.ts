import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIC_TEST_TIMEOUT_MS, MicrophoneTest } from './microphone-test'

/**
 * The settings microphone test's lifecycle.
 *
 * This is the only path in the app that opens the microphone without voice
 * input being enabled, so when it stops is as much the point as when it
 * starts.
 */
function harness() {
  const startMeter = vi.fn()
  const stopMeter = vi.fn()
  const onLevel = vi.fn()
  return {
    startMeter,
    stopMeter,
    onLevel,
    test: new MicrophoneTest({ startMeter, stopMeter, onLevel })
  }
}

afterEach(() => vi.useRealTimers())

describe('MicrophoneTest', () => {
  it('opens the microphone when the test starts', () => {
    const { test, startMeter } = harness()
    test.set(true)
    expect(startMeter).toHaveBeenCalledOnce()
    expect(test.isRunning).toBe(true)
  })

  it('closes it and clears the meter when stopped', () => {
    const { test, stopMeter, onLevel } = harness()
    test.set(true)
    test.set(false)
    expect(stopMeter).toHaveBeenCalledOnce()
    // null is what tells the dialog to put its button back.
    expect(onLevel).toHaveBeenCalledWith(null)
    expect(test.isRunning).toBe(false)
  })

  it('stops itself so a forgotten dialog cannot hold the microphone open', () => {
    vi.useFakeTimers()
    const { test, stopMeter, onLevel } = harness()
    test.set(true)

    vi.advanceTimersByTime(MIC_TEST_TIMEOUT_MS - 1)
    expect(stopMeter).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2)
    expect(stopMeter).toHaveBeenCalledOnce()
    expect(onLevel).toHaveBeenCalledWith(null)
    expect(test.isRunning).toBe(false)
  })

  it('passes levels through while running', () => {
    const { test, onLevel } = harness()
    test.set(true)
    test.level(0.42)
    expect(onLevel).toHaveBeenCalledWith(0.42)
  })

  it('drops levels that arrive after it stopped', () => {
    // The overlay's stream takes a moment to close, and a bar still moving
    // after "stop" says the microphone is open when it is not.
    const { test, onLevel } = harness()
    test.set(true)
    test.set(false)
    onLevel.mockClear()

    test.level(0.42)
    expect(onLevel).not.toHaveBeenCalled()
  })

  it('drops levels that arrive before it ever started', () => {
    const { test, onLevel } = harness()
    test.level(0.42)
    expect(onLevel).not.toHaveBeenCalled()
  })

  it('restarting resets the timeout rather than stacking two', () => {
    vi.useFakeTimers()
    const { test, stopMeter } = harness()
    test.set(true)
    vi.advanceTimersByTime(MIC_TEST_TIMEOUT_MS - 100)

    test.set(true)
    vi.advanceTimersByTime(200)
    expect(stopMeter).not.toHaveBeenCalled()

    vi.advanceTimersByTime(MIC_TEST_TIMEOUT_MS)
    expect(stopMeter).toHaveBeenCalledOnce()
  })

  it('stopping an idle test still clears the meter', () => {
    // The dialog calls this on unmount whether or not a test was running.
    const { test, stopMeter, onLevel } = harness()
    test.set(false)
    expect(stopMeter).toHaveBeenCalledOnce()
    expect(onLevel).toHaveBeenCalledWith(null)
  })

  it('disposing cancels the pending timeout', () => {
    vi.useFakeTimers()
    const { test, stopMeter } = harness()
    test.set(true)
    test.dispose()

    vi.advanceTimersByTime(MIC_TEST_TIMEOUT_MS * 2)
    // Only the dispose itself closed the microphone; no late timer fired.
    expect(stopMeter).toHaveBeenCalledOnce()
  })
})
