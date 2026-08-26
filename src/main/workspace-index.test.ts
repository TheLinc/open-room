import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listWorkspaceFiles, WorkspaceIndex } from './workspace-index'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-room-ws-'))
  await mkdir(join(root, 'src', 'main'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'x'), { recursive: true })
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, 'src', 'main', 'index.ts'), '')
  await writeFile(join(root, 'README.md'), '')
  await writeFile(join(root, 'node_modules', 'x', 'index.js'), '')
  await writeFile(join(root, '.git', 'HEAD'), '')
})

afterEach(() => rm(root, { recursive: true, force: true }))

describe('listWorkspaceFiles', () => {
  it('lists files relative to the root with forward slashes, sorted', async () => {
    expect(await listWorkspaceFiles(root)).toEqual(['README.md', 'src/main/index.ts'])
  })

  it('skips version control and dependency directories', async () => {
    const files = await listWorkspaceFiles(root)
    expect(files.some((f) => f.startsWith('node_modules'))).toBe(false)
    expect(files.some((f) => f.startsWith('.git/'))).toBe(false)
  })

  it('returns an empty list for a missing root rather than throwing', async () => {
    expect(await listWorkspaceFiles(join(root, 'nope'))).toEqual([])
  })
})

describe('WorkspaceIndex', () => {
  it('serves the cached list within the TTL and re-walks after it', async () => {
    let now = 1000
    const index = new WorkspaceIndex({ ttlMs: 100, now: () => now })
    expect(await index.files(root)).toHaveLength(2)

    await writeFile(join(root, 'new.ts'), '')
    expect(await index.files(root)).toHaveLength(2) // cached

    now += 101
    expect(await index.files(root)).toHaveLength(3)
  })
})
