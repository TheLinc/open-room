import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@shared/agent'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { VoiceController, type VoiceControllerDeps } from './voice-controller'

/**
 * The controller is a coordinator, so its collaborators are fakes and the
 * assertions are about ordering and preconditions — which is the point of
 * keeping every decision in the reducer and all the wiring here.
 */

/** Only the fields the controller reads. */
function agent(id: string, name: string, color: string): Agent {
  return { config: { id, name, color }, context: '' } as unknown as Agent
}

const ATLAS = agent('atlas', 'Atlas', 'cyan')

function harness(overrides: Partial<VoiceControllerDeps> = {}) {
  const overlay = {
    send: vi.fn(),
    hide: vi.fn(),
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    discardCapture: vi.fn()
  }
  const sidecar = { transcribe: vi.fn().mockResolvedValue('deploy the branch') }
  // `send` takes the Agent object, not an id — see AgentSupervisor.send.
  const supervisor = { send: vi.fn().mockResolvedValue({ ok: true }) }
  const registerEscape = vi.fn()
  const unregisterEscape = vi.fn()

  const controller = new VoiceController({
    overlay,
    sidecar,
    supervisor,
    readSettings: async () => ({ ...DEFAULT_SETTINGS, voiceInputEnabled: true }),
    listAgents: async () => [ATLAS],
    isModelInstalled: async () => true,
    ensureMicrophoneAccess: async () => true,
    selectedAgentId: () => 'atlas',
    conversationTitleFor: async () => 'CI pipeline',
    startCapture: () => overlay.startCapture(),
    stopCapture: () => overlay.stopCapture(),
    discardCapture: () => overlay.discardCapture(),
    registerEscape,
    unregisterEscape,
    ...overrides
  } as unknown as VoiceControllerDeps)

  const lastState = () => overlay.send.mock.calls.at(-1)?.[0]

  return { controller, overlay, sidecar, supervisor, registerEscape, unregisterEscape, lastState }
}

/** Trigger, stop, and hand over a second of audio. */
async function speak(controller: VoiceController): Promise<void> {
  await controller.onTrigger(null)
  controller.onEvent({ type: 'stopRequested' })
  await controller.onAudio(new Float32Array(16_000))
}

describe('VoiceController preconditions', () => {
  it('refuses to open a capture when no model is installed', async () => {
    const { controller, lastState, overlay } = harness({ isModelInstalled: async () => false })

    await controller.onTrigger(null)

    expect(lastState().phase).toBe('error')
    expect(lastState().message).toMatch(/model/i)
    expect(overlay.startCapture).not.toHaveBeenCalled()
  })

  it('refuses when voice input is disabled', async () => {
    const { controller, lastState } = harness({
      readSettings: async () => ({ ...DEFAULT_SETTINGS, voiceInputEnabled: false })
    })

    await controller.onTrigger(null)

    expect(lastState().phase).toBe('error')
  })

  it('refuses when the microphone was denied, and opens no capture', async () => {
    const { controller, lastState, overlay } = harness({
      ensureMicrophoneAccess: async () => false
    })

    await controller.onTrigger(null)

    expect(lastState().message).toMatch(/microphone/i)
    expect(overlay.startCapture).not.toHaveBeenCalled()
  })

  it('refuses when there is no agent to talk to', async () => {
    const { controller, lastState, overlay } = harness({ selectedAgentId: () => null })

    await controller.onTrigger(null)

    expect(lastState().phase).toBe('error')
    expect(overlay.startCapture).not.toHaveBeenCalled()
  })
})

describe('VoiceController', () => {
  it('shows the agent and conversation before any audio is captured', async () => {
    const { controller, lastState } = harness()

    await controller.onTrigger(null)

    expect(lastState().phase).toBe('listening')
    expect(lastState().agentName).toBe('Atlas')
    expect(lastState().conversationTitle).toBe('CI pipeline')
  })

  it('resolves the conversation title before opening the microphone', async () => {
    // The safeguard is showing where speech will land *before* it is spoken,
    // so resolving the title afterwards would defeat the point of showing it.
    const order: string[] = []
    const { controller } = harness({
      conversationTitleFor: async () => {
        order.push('title')
        return 'CI pipeline'
      },
      startCapture: () => order.push('capture')
    })

    await controller.onTrigger(null)

    expect(order).toEqual(['title', 'capture'])
  })

  it('addresses the agent a per-agent hotkey names, not the selected one', async () => {
    const scout = agent('scout', 'Scout', 'amber')
    const { controller, lastState } = harness({ listAgents: async () => [ATLAS, scout] })

    await controller.onTrigger('scout')

    expect(lastState().agentName).toBe('Scout')
  })

  it('transcribes and dispatches to the target agent', async () => {
    const { controller, sidecar, supervisor, lastState } = harness()

    await speak(controller)

    expect(sidecar.transcribe).toHaveBeenCalled()
    expect(supervisor.send).toHaveBeenCalledWith(ATLAS, 'deploy the branch')
    expect(lastState().phase).toBe('dispatched')
    expect(lastState().transcript).toBe('deploy the branch')
  })

  it('dispatches nothing when the transcript is empty', async () => {
    const { controller, sidecar, supervisor, lastState } = harness()
    sidecar.transcribe.mockResolvedValue('')

    await speak(controller)

    expect(supervisor.send).not.toHaveBeenCalled()
    expect(lastState().phase).toBe('error')
  })

  it('surfaces a transcription failure rather than blipping forever', async () => {
    const { controller, sidecar, supervisor, lastState } = harness()
    sidecar.transcribe.mockRejectedValue(new Error('No speech-to-text model is loaded.'))

    await speak(controller)

    expect(lastState().phase).toBe('error')
    expect(lastState().message).toMatch(/model is loaded/)
    expect(supervisor.send).not.toHaveBeenCalled()
  })

  it('reports a dispatch the supervisor refused', async () => {
    // Showing the tick for a prompt that never reached an agent is the one
    // outcome worse than showing the failure.
    const { controller, supervisor, lastState } = harness()
    supervisor.send.mockResolvedValue({ ok: false, message: 'Agent limit reached' })

    await speak(controller)
    await vi.waitFor(() => expect(lastState().phase).toBe('error'))

    expect(lastState().message).toMatch(/limit/i)
  })

  it('registers Escape for the life of a capture and drops it afterwards', async () => {
    const { controller, registerEscape, unregisterEscape } = harness()

    await controller.onTrigger(null)
    expect(registerEscape).toHaveBeenCalled()

    controller.onEvent({ type: 'cancelRequested' })
    expect(unregisterEscape).toHaveBeenCalled()
  })

  it('throws the audio away when Escape cancels mid-sentence', async () => {
    const { controller, overlay, supervisor, lastState } = harness()

    await controller.onTrigger(null)
    controller.onEvent({ type: 'cancelRequested' })

    expect(overlay.discardCapture).toHaveBeenCalled()
    expect(supervisor.send).not.toHaveBeenCalled()
    expect(lastState().phase).toBe('hidden')
  })

  it('stops and sends when the hotkey is pressed a second time', async () => {
    // Press-again is one of the two ways a capture ends. The reducer ignores a
    // `trigger` during one, so the controller has to translate it.
    const { controller, overlay, lastState } = harness()

    await controller.onTrigger(null)
    await controller.onTrigger(null)

    expect(overlay.stopCapture).toHaveBeenCalled()
    expect(lastState().phase).toBe('transcribing')
  })

  it('does not re-run its preconditions to stop a capture', async () => {
    const isModelInstalled = vi.fn().mockResolvedValue(true)
    const { controller, lastState } = harness({ isModelInstalled })

    await controller.onTrigger(null)
    await controller.onTrigger(null)

    expect(isModelInstalled).toHaveBeenCalledTimes(1)
    expect(lastState().phase).toBe('transcribing')
  })
})

describe('VoiceController dismissal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    return () => vi.useRealTimers()
  })

  it('dismisses the dispatched bubble on its own', async () => {
    const { controller, lastState } = harness()

    await speak(controller)
    expect(lastState().phase).toBe('dispatched')

    vi.advanceTimersByTime(10_000)
    expect(lastState().phase).toBe('hidden')
  })

  it('holds the dispatched bubble while the pointer is on it', async () => {
    const { controller, lastState } = harness()

    await speak(controller)
    controller.setHovered(true)
    vi.advanceTimersByTime(10_000)
    expect(lastState().phase).toBe('dispatched')

    controller.setHovered(false)
    vi.advanceTimersByTime(1000)
    expect(lastState().phase).toBe('hidden')
  })

  it('never dismisses a capture that is still listening', async () => {
    const { controller, lastState } = harness()

    await controller.onTrigger(null)
    vi.advanceTimersByTime(60_000)

    expect(lastState().phase).toBe('listening')
  })
})
