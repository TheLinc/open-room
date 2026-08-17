import { spawn, type ChildProcess } from 'node:child_process'
import {
  decodeMessages,
  encodeMessage,
  type KokoroStatus,
  type SystemVoice,
  type VoiceRequest,
  type VoiceResponse
} from '@shared/voice-rpc'

/**
 * Owns the voice sidecar process and talks to it over stdio.
 *
 * The sidecar is spawned with Electron's own binary in Node mode, so users do
 * not need a system Node install. It is supervised: if it dies, it restarts,
 * and while it is down speech degrades to notifications rather than taking
 * the app with it.
 */

const RESTART_DELAY_MS = 1_000
const MAX_RESTARTS = 5

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class VoiceSidecar {
  private child: ChildProcess | null = null
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private restarts = 0
  private stopping = false

  /**
   * `scriptPath` is injected rather than derived here so this class carries no
   * Electron import, which keeps the sidecar wiring testable outside the app.
   */
  constructor(private readonly scriptPath: string) {}

  /** False while the sidecar is down, so callers can fall back. */
  get isAvailable(): boolean {
    return this.child !== null
  }

  start(): void {
    if (this.child || this.stopping) return

    const child = spawn(process.execPath, [this.scriptPath], {
      // Runs Electron's binary as plain Node, so no separate runtime is
      // needed and the sidecar still stays out of the Electron process.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.child = child
    this.buffer = ''

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.onData(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      console.error('[voice]', String(chunk).trimEnd())
    })

    child.on('error', (error) => {
      console.error('[voice] failed to spawn:', error)
    })

    child.on('exit', (code) => {
      this.child = null
      // Anything in flight will never be answered now.
      this.rejectAll(new Error('Voice sidecar exited'))

      if (this.stopping) return
      if (this.restarts >= MAX_RESTARTS) {
        console.error('[voice] giving up after repeated crashes; speech is notifications only')
        return
      }

      this.restarts += 1
      console.error(`[voice] exited (${code}); restarting in ${RESTART_DELAY_MS}ms`)
      setTimeout(() => this.start(), RESTART_DELAY_MS)
    })
  }

  stop(): void {
    this.stopping = true
    this.rejectAll(new Error('Voice sidecar stopped'))
    this.child?.stdin?.end()
    this.child?.kill()
    this.child = null
  }

  private onData(chunk: string): void {
    const { messages, rest } = decodeMessages(this.buffer + chunk)
    this.buffer = rest

    for (const message of messages) {
      const response = message as VoiceResponse
      const pending = this.pending.get(response.id)
      if (!pending) continue

      this.pending.delete(response.id)
      if (response.ok) {
        // A successful exchange means the sidecar is healthy again.
        this.restarts = 0
        pending.resolve(response.result)
      } else {
        pending.reject(new Error(response.error))
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private request(build: (id: number) => VoiceRequest): Promise<unknown> {
    const child = this.child
    if (!child?.stdin?.writable) {
      return Promise.reject(new Error('Voice sidecar is not running'))
    }

    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })

    child.stdin.write(encodeMessage(build(id)))
    return promise
  }

  async listVoices(): Promise<SystemVoice[]> {
    const result = await this.request((id) => ({ id, method: 'listVoices' }))
    return Array.isArray(result) ? (result as SystemVoice[]) : []
  }

  /** Resolves when playback finishes or is stopped. */
  async speak(
    text: string,
    options: { voiceId?: string; rate: number; provider?: 'system' | 'kokoro' }
  ): Promise<void> {
    await this.request((id) => ({
      id,
      method: 'speak',
      params: {
        text,
        voiceId: options.voiceId,
        rate: options.rate,
        provider: options.provider
      }
    }))
  }

  async kokoroStatus(): Promise<KokoroStatus> {
    const result = await this.request((id) => ({ id, method: 'kokoroStatus' }))
    return (result ?? { loaded: false }) as KokoroStatus
  }

  /** Downloads the weights if needed. Slow on first call; safe to repeat. */
  async loadKokoro(): Promise<void> {
    await this.request((id) => ({ id, method: 'loadKokoro' }))
  }

  async stopSpeaking(): Promise<void> {
    // Fire and forget: a failed stop is not worth surfacing, and the caller
    // is usually mid-preemption with somewhere better to be.
    await this.request((id) => ({ id, method: 'stop' })).catch(() => {})
  }
}
