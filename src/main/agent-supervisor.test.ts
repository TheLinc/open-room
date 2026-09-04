import { describe, expect, it } from 'vitest'
import { AgentSupervisor, type SupervisorEvents } from './agent-supervisor'
import type { ConversationStore } from './conversation-store'
import type { SpeechBus } from './speech-bus'

function supervisor(): { supervisor: AgentSupervisor; events: SupervisorEvents } {
  const events: SupervisorEvents = {
    onRuntime: () => {},
    onTranscript: () => {},
    onPermissionRequest: () => {},
    onPermissionResolved: () => {},
    onTranscriptCleared: () => {},
    onQuota: () => {}
  }
  const store = {} as unknown as ConversationStore
  const speech = {} as unknown as SpeechBus
  return { supervisor: new AgentSupervisor(events, store, speech), events }
}

describe('AgentSupervisor.forget', () => {
  it('drops the runtime of a deleted agent, so nothing lists an agent that no longer exists', async () => {
    const { supervisor: s } = supervisor()
    await s.stop('temp')
    expect(s.allRuntimes().map((r) => r.agentId)).toEqual(['temp'])

    await s.forget('temp')

    expect(s.allRuntimes()).toEqual([])
  })

  it('is a no-op for an agent it has never seen', async () => {
    const { supervisor: s } = supervisor()
    await expect(s.forget('nobody')).resolves.toBeUndefined()
    expect(s.allRuntimes()).toEqual([])
  })
})
