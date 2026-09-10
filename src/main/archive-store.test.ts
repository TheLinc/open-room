import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ArchiveStore, ARCHIVE_FILE } from './archive-store'

let root: string
let store: ArchiveStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-room-archive-'))
  store = new ArchiveStore((agentId) => join(root, 'agents', agentId))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ArchiveStore', () => {
  it('reads an empty map for an agent with no archive file', async () => {
    expect(await store.read('atlas')).toEqual({})
  })

  it('records an archive beside the agent config and reads it back', async () => {
    await store.archive('atlas', 'session-1', 1000)
    expect(await store.read('atlas')).toEqual({ 'session-1': { archivedAt: 1000 } })

    const raw = JSON.parse(await readFile(join(root, 'agents', 'atlas', ARCHIVE_FILE), 'utf8'))
    expect(raw).toEqual({ 'session-1': { archivedAt: 1000 } })
  })

  it('keeps the first archive time if the same session is archived again', async () => {
    await store.archive('atlas', 'session-1', 1000)
    await store.archive('atlas', 'session-1', 2000)
    expect(await store.read('atlas')).toEqual({ 'session-1': { archivedAt: 1000 } })
  })

  it('forgets a session, and forgetting a stranger is a no-op', async () => {
    await store.archive('atlas', 'session-1', 1000)
    await store.forget('atlas', 'session-1')
    await store.forget('atlas', 'never-there')
    expect(await store.read('atlas')).toEqual({})
  })

  it('treats a corrupt file as empty rather than throwing', async () => {
    await store.archive('atlas', 'session-1', 1000)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'agents', 'atlas', ARCHIVE_FILE), '{not json', 'utf8')
    expect(await store.read('atlas')).toEqual({})
  })
})
