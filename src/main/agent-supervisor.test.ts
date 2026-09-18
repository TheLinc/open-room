import { describe, expect, it } from 'vitest'
import { emptyRuntime, type AgentRuntime } from '@shared/agent-runtime'
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

  it('tells the windows to drop the deleted agent’s transcript and runtime', async () => {
    // The renderer keys live entries and runtimes by agent id, and an agent
    // created later under the same name gets the same id: without this the
    // new agent opened on the deleted one's chat and turn count.
    const { supervisor: s, events } = supervisor()
    const cleared: string[] = []
    const runtimes: AgentRuntime[] = []
    events.onTranscriptCleared = (id) => cleared.push(id)
    events.onRuntime = (r) => runtimes.push(r)
    await s.stop('eric')
    runtimes.length = 0

    await s.forget('eric')

    expect(cleared).toEqual(['eric'])
    // `lastActiveAt` is a clock reading, so it is compared as present, not equal.
    expect(runtimes.at(-1)).toEqual({ ...emptyRuntime('eric'), lastActiveAt: expect.any(Number) })
  })

  it('is a no-op for an agent it has never seen', async () => {
    const { supervisor: s } = supervisor()
    await expect(s.forget('nobody')).resolves.toBeUndefined()
    expect(s.allRuntimes()).toEqual([])
  })
})
