import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { decodeLines, encodeLine } from '@shared/session-rpc'
import { SessionReader } from './session-reader'

/** A fake worker: echoes a canned result for every request it reads. */
function fakeChild(answer: (request: { id: number; method: string }) => unknown) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    kill: () => void
    killed: boolean
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    child.emit('exit', 0)
  }
  let buffer = ''
  child.stdin.on('data', (chunk: Buffer) => {
    const decoded = decodeLines(buffer + chunk.toString())
    buffer = decoded.rest
    for (const request of decoded.messages as { id: number; method: string }[]) {
      child.stdout.write(encodeLine({ id: request.id, result: answer(request) }))
    }
  })
  return child
}

describe('SessionReader', () => {
  it('spawns the worker with CLAUDE_CONFIG_DIR set and answers a list', async () => {
    const spawnChild = vi.fn(() => fakeChild(() => [{ sessionId: 's1' }]))
    const reader = new SessionReader(
      'out/main/sessions.js',
      async () => '\\\\wsl.localhost\\Ubuntu\\home\\u\\.claude',
      spawnChild as never
    )

    const sessions = await reader.listSessions({
      dir: '/home/u/proj',
      limit: 100,
      includeWorktrees: false
    })

    expect(sessions).toEqual([{ sessionId: 's1' }])
    const [script, env] = spawnChild.mock.calls[0] as unknown as [string, Record<string, string>]
    expect(script).toBe('out/main/sessions.js')
    expect(env.CLAUDE_CONFIG_DIR).toBe('\\\\wsl.localhost\\Ubuntu\\home\\u\\.claude')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    reader.stop()
  })

  it('answers empty without spawning when the config dir is unknown', async () => {
    // No distro home means no sessions to read; failing loudly here would
    // make an idle WSL agent look broken every time its pane opened.
    const spawnChild = vi.fn()
    const reader = new SessionReader('x.js', async () => null, spawnChild as never)
    expect(await reader.listSessions({ dir: '/x', limit: 10, includeWorktrees: false })).toEqual([])
    expect(await reader.getSessionMessages('s', { dir: '/x' })).toEqual([])
    expect(spawnChild).not.toHaveBeenCalled()
  })

  it('reuses one worker across calls and matches responses by id', async () => {
    const spawnChild = vi.fn(() => fakeChild((r) => (r.method === 'list' ? ['L'] : ['M'])))
    const reader = new SessionReader('x.js', async () => 'C:\\cfg', spawnChild as never)
    const [a, b] = await Promise.all([
      reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false }),
      reader.getSessionMessages('s', { dir: '/x' })
    ])
    expect(a).toEqual(['L'])
    expect(b).toEqual(['M'])
    expect(spawnChild).toHaveBeenCalledTimes(1)
    reader.stop()
  })

  it('rejects in-flight requests when the worker exits, then respawns on the next call', async () => {
    let child = fakeChild(() => [])
    const spawnChild = vi.fn(() => child)
    const reader = new SessionReader('x.js', async () => 'C:\\cfg', spawnChild as never)
    await reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })
    child.emit('exit', 1)
    child = fakeChild(() => ['again'])
    expect(await reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })).toEqual([
      'again'
    ])
    expect(spawnChild).toHaveBeenCalledTimes(2)
    reader.stop()
  })
})
