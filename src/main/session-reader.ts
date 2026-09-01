import { spawn, type ChildProcess } from 'node:child_process'
import {
  deleteSession,
  getSessionMessages,
  listSessions,
  renameSession,
  tagSession,
  type SDKSessionInfo,
  type SessionMessage
} from '@anthropic-ai/claude-agent-sdk'
import {
  decodeLines,
  encodeLine,
  type SessionRequest,
  type SessionResponse
} from '@shared/session-rpc'

/**
 * The five session operations ConversationStore needs, so a WSL agent's
 * conversations can be read from the distro's ~/.claude while host agents
 * keep calling the SDK directly.
 */
export type SessionApi = {
  listSessions: (o: {
    dir: string
    limit: number
    includeWorktrees: boolean
  }) => Promise<SDKSessionInfo[]>
  getSessionMessages: (sessionId: string, o: { dir: string }) => Promise<SessionMessage[]>
  renameSession: (sessionId: string, title: string, o: { dir: string }) => Promise<void>
  tagSession: (sessionId: string, tag: string | null, o: { dir: string }) => Promise<void>
  deleteSession: (sessionId: string, o: { dir: string }) => Promise<void>
}

/** The host: the SDK's own functions, reading this user's ~/.claude. */
export const hostSessions: SessionApi = {
  listSessions: (o) => listSessions(o),
  getSessionMessages: (id, o) => getSessionMessages(id, o),
  renameSession: (id, title, o) => renameSession(id, title, o),
  tagSession: (id, tag, o) => tagSession(id, tag, o),
  deleteSession: (id, o) => deleteSession(id, o)
}

/** What the reader needs from a child: enough for a fake to satisfy it. */
export type WorkerProcess = Pick<ChildProcess, 'stdin' | 'stdout' | 'kill' | 'on' | 'killed'>

export type SpawnWorker = (script: string, env: Record<string, string>) => WorkerProcess

const defaultSpawn: SpawnWorker = (script, env) =>
  spawn(process.execPath, [script], { env, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/**
 * One spawned child's own state. Node delivers `exit` asynchronously after
 * `kill()`, so a stale worker's listeners must never touch the reader's
 * current state directly — only this record, which the reader detaches
 * from (`this.worker = null`) the moment a worker is replaced or dies.
 */
type Worker = {
  child: WorkerProcess
  buffer: string
  pending: Map<number, Pending>
}

/**
 * Runs the SDK's session functions in a worker whose CLAUDE_CONFIG_DIR is a
 * WSL distro's ~/.claude over \\wsl.localhost. Measured: the SDK finds a
 * session under a mixed-case slug that way and reads its messages.
 *
 * One worker per reader, started on first use and restarted on the next
 * call after it exits. The config dir is a thunk because it needs the
 * distro's home, which is a wsl.exe round trip nobody should pay at launch.
 */
export class SessionReader implements SessionApi {
  private worker: Worker | null = null
  private nextId = 1

  constructor(
    private readonly scriptPath: string,
    private readonly configDir: () => Promise<string | null>,
    private readonly spawnChild: SpawnWorker = defaultSpawn
  ) {}

  listSessions(o: {
    dir: string
    limit: number
    includeWorktrees: boolean
  }): Promise<SDKSessionInfo[]> {
    return this.call({ method: 'list', params: o }, [] as SDKSessionInfo[])
  }

  getSessionMessages(sessionId: string, o: { dir: string }): Promise<SessionMessage[]> {
    return this.call(
      { method: 'messages', params: { sessionId, dir: o.dir } },
      [] as SessionMessage[]
    )
  }

  async renameSession(sessionId: string, title: string, o: { dir: string }): Promise<void> {
    await this.call({ method: 'rename', params: { sessionId, dir: o.dir, title } }, undefined)
  }

  async tagSession(sessionId: string, tag: string | null, o: { dir: string }): Promise<void> {
    await this.call({ method: 'tag', params: { sessionId, dir: o.dir, tag } }, undefined)
  }

  async deleteSession(sessionId: string, o: { dir: string }): Promise<void> {
    await this.call({ method: 'delete', params: { sessionId, dir: o.dir } }, undefined)
  }

  stop(): void {
    this.worker?.child.kill()
    this.worker = null
  }

  /** Sends one request; `empty` is the answer when there is no config dir to read. */
  private async call<T>(request: Omit<SessionRequest, 'id'>, empty: T): Promise<T> {
    const configDir = await this.configDir()
    if (!configDir) return empty
    const worker = this.ensureWorker(configDir)
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => {
      worker.pending.set(id, { resolve, reject })
      try {
        worker.child.stdin!.write(encodeLine({ id, ...request }))
      } catch (error) {
        worker.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    return (await result) as T
  }

  private ensureWorker(configDir: string): Worker {
    if (this.worker) return this.worker
    const child = this.spawnChild(this.scriptPath, {
      ...(process.env as Record<string, string>),
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDE_CONFIG_DIR: configDir
    })
    const worker: Worker = { child, buffer: '', pending: new Map() }

    const detach = (reason: string): void => {
      if (this.worker === worker) this.worker = null
      for (const waiting of worker.pending.values()) waiting.reject(new Error(reason))
      worker.pending.clear()
    }

    child.stdout!.on('data', (chunk: Buffer | string) => {
      const decoded = decodeLines(worker.buffer + chunk.toString())
      worker.buffer = decoded.rest
      for (const message of decoded.messages as SessionResponse[]) {
        const waiting = worker.pending.get(message.id)
        if (!waiting) continue
        worker.pending.delete(message.id)
        if (message.error !== undefined) waiting.reject(new Error(message.error))
        else waiting.resolve(message.result)
      }
    })
    child.on('exit', () => detach('Sessions worker exited'))
    child.on('error', () => {
      detach('Sessions worker failed')
      child.kill()
    })

    this.worker = worker
    return worker
  }
}
