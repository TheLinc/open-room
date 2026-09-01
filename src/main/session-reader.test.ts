import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { decodeLines, encodeLine } from '@shared/session-rpc'
import { SessionReader } from './session-reader'

/**
 * A fake worker: echoes a canned result for every request it reads.
 *
 * `exitOnKill` defaults to true, matching real child processes closely
 * enough for the existing tests. Set it false to simulate a `kill()` whose
 * `exit` has not arrived yet — Node delivers it asynchronously — so a test
 * can drive a stale worker's cleanup independently of a fresh one's.
 *
 * `answer` returning `undefined` means "write nothing back", for a worker
 * that errors before it can respond.
 */
function fakeChild(
  answer: (request: { id: number; method: string }) => unknown,
  options: { exitOnKill?: boolean } = {}
) {
  const { exitOnKill = true } = options
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
    if (exitOnKill) child.emit('exit', 0)
  }
  let buffer = ''
  child.stdin.on('data', (chunk: Buffer) => {
    const decoded = decodeLines(buffer + chunk.toString())
    buffer = decoded.rest
    for (const request of decoded.messages as { id: number; method: string }[]) {
      const result = answer(request)
      if (result === undefined) continue
      child.stdout.write(encodeLine({ id: request.id, result }))
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

  it("a stale worker exiting does not disturb the new worker's requests", async () => {
    const childA = fakeChild(() => ['A'], { exitOnKill: false })
    const childB = fakeChild(() => ['B'])
    const spawnChild = vi.fn().mockReturnValueOnce(childA).mockReturnValueOnce(childB)
    const reader = new SessionReader('x.js', async () => 'C:\\cfg', spawnChild as never)

    // Spawn A, then stop it. `exitOnKill: false` means its 'exit' has not
    // arrived yet, mirroring the real async gap after kill().
    await reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })
    reader.stop()

    // The next call spawns B and resolves against it, not A.
    const second = await reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })
    expect(second).toEqual(['B'])

    // Start a request against B while A's stale exit is still pending, then
    // let A's exit arrive mid-flight: it must not disturb B's request.
    const inFlight = reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })
    childA.emit('exit', 1)
    await expect(inFlight).resolves.toEqual(['B'])

    // A third call still uses B; A's belated exit never caused a respawn.
    const third = await reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })
    expect(third).toEqual(['B'])
    expect(spawnChild).toHaveBeenCalledTimes(2)
    reader.stop()
  })

  it('rejects in-flight requests on a worker error even when no exit follows', async () => {
    const child = fakeChild(() => undefined, { exitOnKill: false })
    const spawnChild = vi.fn(() => child)
    const reader = new SessionReader('x.js', async () => 'C:\\cfg', spawnChild as never)

    const promise = reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })
    // ensureWorker attaches the 'error' listener after the async configDir
    // thunk resolves; give that a turn before emitting, or a bare
    // EventEmitter throws 'error' as an uncaught exception with no listener.
    await new Promise((resolve) => setTimeout(resolve, 0))
    child.emit('error', new Error('spawn failed'))
    await expect(promise).rejects.toThrow(/Sessions worker/)

    // A following call spawns a fresh worker rather than reusing the dead one.
    spawnChild.mockReturnValueOnce(fakeChild(() => ['again']))
    expect(await reader.listSessions({ dir: '/x', limit: 1, includeWorktrees: false })).toEqual([
      'again'
    ])
    expect(spawnChild).toHaveBeenCalledTimes(2)
    reader.stop()
  })
})
