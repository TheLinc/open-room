import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Priming the speech scripts costs about 1.6s and it follows the process, not
 * the app — so a sidecar that crashed and came back is exactly as cold as one
 * that just launched. Warming only on `whenReady` would leave the first
 * utterance after any crash slow again, silently and only in the field.
 */

const spawned: FakeChild[] = []

class FakeChild extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  written: string[] = []
  stdin = {
    writable: true,
    write: (chunk: string) => this.written.push(chunk),
    end: () => {}
  }
  kill = (): void => {}
}

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = new FakeChild()
    spawned.push(child)
    return child
  }
}))

const { VoiceSidecar } = await import('./voice-sidecar')

beforeEach(() => {
  spawned.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('VoiceSidecar onStart', () => {
  it('runs once the child is writable, so a warm request is not dropped', () => {
    const sidecar = new VoiceSidecar('voice.js', () => void sidecar.warm())
    sidecar.start()

    expect(spawned).toHaveLength(1)
    // Dropped silently if `child` were not in place yet.
    expect(spawned[0].written.join('')).toContain('"method":"warm"')
  })

  it('runs again after the sidecar crashes and restarts', () => {
    let starts = 0
    const sidecar = new VoiceSidecar('voice.js', () => {
      starts += 1
    })
    sidecar.start()
    expect(starts).toBe(1)

    spawned[0].emit('exit', 1)
    vi.advanceTimersByTime(1000)

    expect(spawned).toHaveLength(2)
    expect(starts).toBe(2)
  })

  it('does not run when a deliberate stop keeps the sidecar down', () => {
    let starts = 0
    const sidecar = new VoiceSidecar('voice.js', () => {
      starts += 1
    })
    sidecar.start()
    sidecar.stop()
    vi.advanceTimersByTime(5000)

    expect(starts).toBe(1)
    expect(spawned).toHaveLength(1)
  })

  it('is optional, so nothing breaks without one', () => {
    const sidecar = new VoiceSidecar('voice.js')
    expect(() => sidecar.start()).not.toThrow()
  })
})
