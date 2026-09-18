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

describe('ConversationStore agent scoping', () => {
  const session = (sessionId: string, tag: string): unknown => ({
    sessionId,
    tag,
    firstPrompt: sessionId,
    lastModified: 1
  })

  it('does not hand a recreated agent the deleted one’s conversations', async () => {
    const chosen = api([session('old', 'open-room:atlas'), session('new', 'open-room:atlas:b2')])
    const store = new ConversationStore(null, () => chosen)
    const recreated = agent('atlas', '/p')
    recreated.config.instance = 'b2'
    const ids = (await store.list(recreated)).map((c) => c.sessionId)
    expect(ids).toEqual(['new'])
  })

  it('keeps the bare tag for an agent from before instances', async () => {
    const chosen = api([session('old', 'open-room:atlas'), session('new', 'open-room:atlas:b2')])
    const store = new ConversationStore(null, () => chosen)
    const ids = (await store.list(agent('atlas', '/p'))).map((c) => c.sessionId)
    expect(ids).toEqual(['old'])
  })

  it('claims a session under the instance tag', async () => {
    const chosen = api()
    const store = new ConversationStore(null, () => chosen)
    const a = agent('atlas', '/p')
    a.config.instance = 'b2'
    await store.claim(a, 's1')
    expect(chosen.tagSession).toHaveBeenCalledWith('s1', 'open-room:atlas:b2', { dir: '/p' })
  })
})
