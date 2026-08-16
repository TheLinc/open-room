import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAgent } from '@shared/agent'
import { ConfigStore } from './config-store'

let root: string
let store: ConfigStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-room-test-'))
  store = new ConfigStore(root)
})

afterEach(async () => {
  store.stopWatching()
  await rm(root, { recursive: true, force: true })
})

const atlas = () => createDefaultAgent('Atlas', join(root, 'workspace'), 'amber')

describe('ConfigStore round trip', () => {
  it('creates the agents directory on first use', async () => {
    const { agents, errors } = await store.list()
    expect(agents).toEqual([])
    expect(errors).toEqual([])
  })

  it('writes and reads an agent back unchanged', async () => {
    const agent = atlas()
    await store.write(agent)

    const read = await store.read('atlas')
    expect(read.config).toEqual(agent.config)
    expect(read.context).toBe(agent.context)
  })

  it('writes config.json and AGENT.md as separate hand-editable files', async () => {
    await store.write(atlas())
    const dir = join(root, 'agents', 'atlas')

    const raw = await readFile(join(dir, 'config.json'), 'utf8')
    expect(JSON.parse(raw).name).toBe('Atlas')
    expect(raw.endsWith('\n')).toBe(true)

    const context = await readFile(join(dir, 'AGENT.md'), 'utf8')
    expect(context).toContain('WORKLOG.md')
  })

  it('lists agents sorted by name', async () => {
    await store.write(createDefaultAgent('Zephyr', root, 'sky'))
    await store.write(createDefaultAgent('Atlas', root, 'amber'))

    const { agents } = await store.list()
    expect(agents.map((a) => a.config.name)).toEqual(['Atlas', 'Zephyr'])
  })

  it('deletes an agent', async () => {
    await store.write(atlas())
    expect(await store.exists('atlas')).toBe(true)

    await store.delete('atlas')
    expect(await store.exists('atlas')).toBe(false)
  })

  it('rejects writing a config that fails validation', async () => {
    const agent = atlas()
    agent.config.model = 'gpt-4'
    await expect(store.write(agent)).rejects.toThrow()
  })
})

describe('ConfigStore surfaces bad files instead of hiding them', () => {
  it('reports invalid JSON with the reason', async () => {
    const dir = join(root, 'agents', 'broken')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'config.json'), '{ not json', 'utf8')

    const { agents, errors } = await store.list()
    expect(agents).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].id).toBe('broken')
    expect(errors[0].message).toContain('not valid JSON')
  })

  it('reports schema violations with the offending field', async () => {
    const dir = join(root, 'agents', 'atlas')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ id: 'atlas', name: 'Atlas', color: 'amber', model: 'gpt-4' }),
      'utf8'
    )

    const { errors } = await store.list()
    expect(errors[0].message).toContain('model')
  })

  it('reports a missing config.json', async () => {
    await mkdir(join(root, 'agents', 'empty'), { recursive: true })

    const { errors } = await store.list()
    expect(errors[0].message).toContain('missing')
  })

  it('rejects a config whose id does not match its directory', async () => {
    const dir = join(root, 'agents', 'renamed-by-hand')
    await mkdir(dir, { recursive: true })
    const agent = atlas()
    await writeFile(join(dir, 'config.json'), JSON.stringify(agent.config), 'utf8')

    const { errors } = await store.list()
    expect(errors[0].message).toContain('declares id')
  })

  it('keeps loading good agents when a sibling is broken', async () => {
    await store.write(atlas())
    const dir = join(root, 'agents', 'broken')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'config.json'), 'nope', 'utf8')

    const { agents, errors } = await store.list()
    expect(agents.map((a) => a.config.id)).toEqual(['atlas'])
    expect(errors.map((e) => e.id)).toEqual(['broken'])
  })

  it('treats a missing AGENT.md as empty context rather than an error', async () => {
    const dir = join(root, 'agents', 'atlas')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'config.json'), JSON.stringify(atlas().config), 'utf8')

    const read = await store.read('atlas')
    expect(read.context).toBe('')
  })
})

describe('ConfigStore watching', () => {
  it('notifies on external edits, debounced into one call', async () => {
    let calls = 0
    await store.startWatching(() => {
      calls += 1
    }, 50)

    await store.write(atlas())
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(calls).toBeGreaterThanOrEqual(1)
    // A single write touches two files plus a directory; without debouncing
    // this would fire several times.
    expect(calls).toBeLessThanOrEqual(2)
  })

  it('stops notifying after stopWatching', async () => {
    let calls = 0
    await store.startWatching(() => {
      calls += 1
    }, 20)
    store.stopWatching()

    await store.write(atlas())
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(calls).toBe(0)
  })
})
