import { describe, expect, it, vi } from 'vitest'
import { probeModelAccess, type ProbeQuery } from './model-access'

/**
 * A stand-in for `query()`: emits the init the CLI sends once a first
 * message has arrived, answers `supportedModels`, and records `close`.
 */
function fakeQuery(rows: { value: string; resolvedModel?: string }[]): {
  query: ProbeQuery
  closed: () => boolean
  firstPrompt: () => Promise<string>
} {
  let closed = false
  let resolveFirst: (text: string) => void = () => {}
  const firstPrompt = new Promise<string>((resolve) => (resolveFirst = resolve))

  const query: ProbeQuery = (params) => {
    const prompt = params.prompt
    void (async () => {
      for await (const message of prompt) {
        const content = (message as { message: { content: unknown } }).message.content
        resolveFirst(String(content))
        break
      }
    })()

    const iterator = (async function* () {
      yield { type: 'system', subtype: 'init' }
      await new Promise(() => {})
    })()
    return Object.assign(iterator, {
      supportedModels: async () => rows,
      close: () => {
        closed = true
      }
    })
  }
  return { query, closed: () => closed, firstPrompt: () => firstPrompt }
}

describe('probeModelAccess', () => {
  it('reads the model list off the init and closes the session', async () => {
    const fake = fakeQuery([{ value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1' }])
    const access = await probeModelAccess({ query: fake.query, binary: 'C:/claude.exe' })
    expect(access).toMatchObject({ state: 'known', fable: true })
    expect(fake.closed()).toBe(true)
  })

  it('sends a local slash command, never a prompt that costs a model turn', async () => {
    const fake = fakeQuery([])
    await probeModelAccess({ query: fake.query, binary: 'C:/claude.exe' })
    expect(await fake.firstPrompt()).toBe('/context')
  })

  it('is unknown without a binary, on a throw, and on a timeout', async () => {
    expect(await probeModelAccess({ query: vi.fn(), binary: null })).toEqual({ state: 'unknown' })

    const throwing: ProbeQuery = () => {
      throw new Error('spawn failed')
    }
    expect(await probeModelAccess({ query: throwing, binary: 'C:/claude.exe' })).toEqual({
      state: 'unknown'
    })

    const silent: ProbeQuery = () =>
      Object.assign(
        (async function* () {
          await new Promise(() => {})
          // Never reached; a generator with nothing to yield is a lint error.
          yield { type: 'system', subtype: 'init' }
        })(),
        { supportedModels: async () => [], close: () => {} }
      )
    expect(
      await probeModelAccess({ query: silent, binary: 'C:/claude.exe', timeoutMs: 10 })
    ).toEqual({ state: 'unknown' })
  })
})
