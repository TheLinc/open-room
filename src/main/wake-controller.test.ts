import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@shared/agent'
import { WakeController, type WakeControllerDeps } from './wake-controller'

const agent = (id: string, name: string): Agent =>
  ({ config: { id, name, color: 'cyan' }, context: '' }) as unknown as Agent

const DEREK = agent('derek', 'Derek')
const ATLAS = agent('atlas', 'Atlas')

function harness(overrides: Partial<WakeControllerDeps> = {}) {
  const overlay = { startWake: vi.fn(), stopWake: vi.fn(), muteWake: vi.fn() }
  const sidecar = {
    listen: vi.fn().mockResolvedValue({ speech: true, text: 'Hey Derek, run the tests' })
  }
  const supervisor = { send: vi.fn().mockResolvedValue({ ok: true }) }
  const startCapture = vi.fn()

  const controller = new WakeController({
    overlay,
    sidecar,
    supervisor,
    listAgents: async () => [DEREK, ATLAS],
    nowSpeaking: () => null,
    startCapture,
    ...overrides
  } as unknown as WakeControllerDeps)

  // Listening, as it would be whenever a segment actually arrives.
  controller.start()

  return { controller, overlay, sidecar, supervisor, startCapture }
}

const SEGMENT = new Float32Array(16_000)

describe('WakeController', () => {
  it('dispatches the words after the wake phrase', async () => {
    const { controller, supervisor } = harness()

    await controller.onSegment(SEGMENT)

    expect(supervisor.send).toHaveBeenCalledWith(DEREK, 'run the tests')
  })

  it('ignores a segment the gate rejected, without transcribing it', async () => {
    const { controller, supervisor, sidecar } = harness()
    sidecar.listen.mockResolvedValue({ speech: false })

    await controller.onSegment(SEGMENT)

    expect(supervisor.send).not.toHaveBeenCalled()
  })

  it('ignores speech that is not addressed to an agent', async () => {
    const { controller, supervisor, sidecar } = harness()
    sidecar.listen.mockResolvedValue({ speech: true, text: 'what time is the meeting' })

    await controller.onSegment(SEGMENT)

    expect(supervisor.send).not.toHaveBeenCalled()
  })

  it('cannot be triggered by an agent speaking', async () => {
    // The SpeechBus emits a bare name prefix, which is not a wake phrase.
    const { controller, supervisor, sidecar } = harness()
    sidecar.listen.mockResolvedValue({ speech: true, text: 'Derek — the build is green' })

    await controller.onSegment(SEGMENT)

    expect(supervisor.send).not.toHaveBeenCalled()
  })

  it('drops a segment that echoes what is being spoken', async () => {
    // Belt and braces behind the mute: this is the audio already in flight
    // when playback started.
    const { controller, supervisor, sidecar } = harness({
      nowSpeaking: () => 'Derek — hey Derek run the tests now'
    })
    sidecar.listen.mockResolvedValue({ speech: true, text: 'hey Derek run the tests' })

    await controller.onSegment(SEGMENT)

    expect(supervisor.send).not.toHaveBeenCalled()
  })

  it('opens a capture for a bare address rather than sending nothing', async () => {
    const { controller, supervisor, startCapture, sidecar } = harness()
    sidecar.listen.mockResolvedValue({ speech: true, text: 'Hey Derek' })

    await controller.onSegment(SEGMENT)

    expect(startCapture).toHaveBeenCalledWith('derek')
    expect(supervisor.send).not.toHaveBeenCalled()
  })

  it('addresses the agent that was named, not the selected one', async () => {
    const { controller, supervisor, sidecar } = harness()
    sidecar.listen.mockResolvedValue({ speech: true, text: 'Hey Atlas, deploy the branch' })

    await controller.onSegment(SEGMENT)

    expect(supervisor.send).toHaveBeenCalledWith(ATLAS, 'deploy the branch')
  })

  it('ignores a segment that arrives after listening stopped', async () => {
    const { controller, supervisor } = harness()

    controller.stop()
    await controller.onSegment(SEGMENT)

    expect(supervisor.send).not.toHaveBeenCalled()
  })

  it('mutes the listener while the app speaks and unmutes after', async () => {
    vi.useFakeTimers()
    const { controller, overlay } = harness()

    controller.setSpeaking(true)
    expect(overlay.muteWake).toHaveBeenCalledWith(true)

    controller.setSpeaking(false)
    expect(overlay.muteWake).not.toHaveBeenCalledWith(false)

    // Unmuting is delayed: the tail of playback is still travelling to the mic.
    vi.advanceTimersByTime(400)
    expect(overlay.muteWake).toHaveBeenCalledWith(false)

    vi.useRealTimers()
  })

  it('starts and stops the overlay listener', () => {
    const { controller, overlay } = harness()

    expect(overlay.startWake).toHaveBeenCalled()

    controller.stop()
    expect(overlay.stopWake).toHaveBeenCalled()
  })

  it('does not start the listener twice', () => {
    const { controller, overlay } = harness()

    controller.start()

    expect(overlay.startWake).toHaveBeenCalledTimes(1)
  })
})
