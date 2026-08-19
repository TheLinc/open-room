import { describe, expect, it, vi } from 'vitest'
import { Meter, REPORT_INTERVAL_MS, type CaptureLike } from './meter'

/**
 * The metering stream, without a microphone.
 *
 * The behaviour worth guarding is what happens when the user picks a
 * different device mid-test: metering the old one would confirm the wrong
 * microphone, which is worse than showing no meter at all.
 */

class FakeCapture implements CaptureLike {
  started = false
  discarded = false
  rms = 0
  constructor(private readonly failWith?: Error) {}

  async start(): Promise<void> {
    if (this.failWith) throw this.failWith
    this.started = true
  }
  level(): number {
    return this.rms
  }
  discard(): void {
    this.discarded = true
  }
}

function harness(options: { captures?: CaptureLike[]; deviceId?: string } = {}) {
  const made: CaptureLike[] = []
  const queue = [...(options.captures ?? [])]
  let deviceId = options.deviceId ?? ''
  let now = 0

  const onLevel = vi.fn()
  const onError = vi.fn()

  const meter = new Meter(onLevel, onError, {
    createCapture: () => {
      const capture = queue.shift() ?? new FakeCapture()
      made.push(capture)
      return capture
    },
    currentDeviceId: () => deviceId,
    now: () => now,
    // The real one is requestAnimationFrame; tests drive `tick` by hand.
    schedule: () => 0,
    cancel: () => {}
  })

  return {
    meter,
    onLevel,
    onError,
    made,
    setDevice: (id: string) => (deviceId = id),
    advance: (ms: number) => (now += ms)
  }
}

const latest = (made: CaptureLike[]): FakeCapture => made[made.length - 1] as FakeCapture

describe('Meter', () => {
  it('reports the level once the report interval has passed', async () => {
    const h = harness()
    await h.meter.start()
    latest(h.made).rms = 0.3

    h.advance(REPORT_INTERVAL_MS)
    h.meter.tick()

    expect(h.onLevel).toHaveBeenCalledWith(0.3)
  })

  it('throttles, rather than reporting on every frame', async () => {
    // The poll runs on animation frames because that is when a new reading
    // exists; sixty IPC messages a second to move one bar is waste.
    const h = harness()
    await h.meter.start()

    h.advance(REPORT_INTERVAL_MS)
    h.meter.tick()
    h.onLevel.mockClear()

    h.advance(REPORT_INTERVAL_MS - 1)
    h.meter.tick()
    expect(h.onLevel).not.toHaveBeenCalled()

    h.advance(1)
    h.meter.tick()
    expect(h.onLevel).toHaveBeenCalledOnce()
  })

  it('reopens on the device the user just picked', async () => {
    const h = harness()
    await h.meter.start()
    const first = latest(h.made)

    h.setDevice('another-microphone')
    h.meter.tick()
    await Promise.resolve()
    await Promise.resolve()

    expect(first.discarded).toBe(true)
    expect(h.made).toHaveLength(2)
    expect(latest(h.made).started).toBe(true)
  })

  it('does not report the old device on the frame it restarts', async () => {
    // A reading from the stream being torn down is a reading from the wrong
    // microphone, which is the exact thing this control exists to rule out.
    const h = harness()
    await h.meter.start()
    latest(h.made).rms = 0.9

    h.advance(REPORT_INTERVAL_MS)
    h.setDevice('another-microphone')
    h.meter.tick()

    expect(h.onLevel).not.toHaveBeenCalled()
  })

  it('keeps the stream when the device has not changed', async () => {
    const h = harness()
    await h.meter.start()

    h.advance(REPORT_INTERVAL_MS)
    h.meter.tick()

    expect(h.made).toHaveLength(1)
  })

  it('ignores a second start rather than opening two streams', async () => {
    const h = harness()
    await h.meter.start()
    await h.meter.start()

    expect(h.made).toHaveLength(1)
  })

  it('stops reporting and releases the microphone on stop', async () => {
    const h = harness()
    await h.meter.start()
    const capture = latest(h.made)

    h.meter.stop()
    h.advance(REPORT_INTERVAL_MS)
    h.meter.tick()

    expect(capture.discarded).toBe(true)
    expect(h.onLevel).not.toHaveBeenCalled()
    expect(h.meter.isRunning).toBe(false)
  })

  it('says so when microphone access was denied', async () => {
    const denied = new Error('denied')
    denied.name = 'NotAllowedError'
    const h = harness({ captures: [new FakeCapture(denied)] })

    await h.meter.start()

    expect(h.onError).toHaveBeenCalledWith('Microphone access was denied')
    expect(h.meter.isRunning).toBe(false)
  })

  it('reports any other failure to open in general terms', async () => {
    const h = harness({ captures: [new FakeCapture(new Error('device on fire'))] })

    await h.meter.start()

    expect(h.onError).toHaveBeenCalledWith('Could not open the microphone')
  })

  it('can be started again after a failure', async () => {
    const h = harness({ captures: [new FakeCapture(new Error('nope')), new FakeCapture()] })
    await h.meter.start()

    await h.meter.start()

    expect(h.meter.isRunning).toBe(true)
  })
})
