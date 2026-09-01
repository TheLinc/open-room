import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@shared/agent'
import { ConversationStore } from './conversation-store'
import type { SessionApi } from './session-reader'

const agent = (id: string, workspacePath: string): Agent =>
  ({
    config: { id, name: id, workspacePath, wsl: null, persistSession: true },
    context: ''
  }) as unknown as Agent

function api(sessions: unknown[] = []): SessionApi {
  return {
    listSessions: vi.fn(async () => sessions as never),
    getSessionMessages: vi.fn(async () => []),
    renameSession: vi.fn(async () => {}),
    tagSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {})
  }
}

describe('ConversationStore session api', () => {
  it('asks the api chosen for the agent, with the workspace as dir', async () => {
    const chosen = api()
    const store = new ConversationStore(null, () => chosen)
    await store.list(agent('atlas', '/home/u/proj'))
    expect(chosen.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ dir: '/home/u/proj' })
    )
  })

  it('routes rename and delete through the same api', async () => {
    const chosen = api()
    const store = new ConversationStore(null, () => chosen)
    const a = agent('atlas', '/home/u/proj')
    await store.rename(a, 's1', 'Title')
    await store.remove(a, 's1')
    expect(chosen.renameSession).toHaveBeenCalledWith('s1', 'Title', { dir: '/home/u/proj' })
    expect(chosen.deleteSession).toHaveBeenCalledWith('s1', { dir: '/home/u/proj' })
  })
})
