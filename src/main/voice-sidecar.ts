import { spawn, type ChildProcess } from 'node:child_process'
import { encodePcm } from '@shared/pcm'
import {
  decodeMessages,
  encodeMessage,
  type KokoroStatus,
  type ListenResult,
  type SttStatus,
  type VadStatus,
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
   *
   * `onStart` runs after every successful spawn, not just the first. Priming
   * costs follow the process, so a sidecar that crashed and came back is as
   * cold as one that has just launched.
   */
  constructor(
    private readonly scriptPath: string,
    private readonly onStart?: () => void
  ) {}

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

    // Last, so anything it sends finds `child` in place and writable.
    this.onStart?.()
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

  /**
   * Runs each speech script once so the user's first sentence does not.
   *
   * Silent, and worth about 1.6s on a Windows launch. Fire and forget: a
   * failed warm costs latency, never correctness.
   */
  async warm(): Promise<void> {
    await this.request((id) => ({ id, method: 'warm' }))
  }

  async kokoroStatus(): Promise<KokoroStatus> {
    const result = await this.request((id) => ({ id, method: 'kokoroStatus' }))
    return (result ?? { loaded: false, installed: false }) as KokoroStatus
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

  async sttStatus(): Promise<SttStatus> {
    const result = await this.request((id) => ({ id, method: 'sttStatus' }))
    return (result ?? { loaded: false, installed: false }) as SttStatus
  }

  /**
   * Downloads the model if it is missing, then loads it.
   *
   * Minutes on first call — 147 MB — and under a second afterwards. Poll
   * `sttStatus` for progress rather than waiting on this in a UI.
   */
  async loadStt(): Promise<void> {
    await this.request((id) => ({ id, method: 'loadStt' }))
  }

  async vadStatus(): Promise<VadStatus> {
    const result = await this.request((id) => ({ id, method: 'vadStatus' }))
    return (result ?? { loaded: false, installed: false }) as VadStatus
  }

  /** Downloads the 2 MB model if it is missing, then loads it. */
  async loadVad(): Promise<void> {
    await this.request((id) => ({ id, method: 'loadVad' }))
  }

  /**
   * One always-on listening segment. Gated by VAD in the sidecar, so most
   * calls return `{ speech: false }` without Whisper ever running.
   */
  async listen(samples: Float32Array): Promise<ListenResult> {
    const result = await this.request((id) => ({
      id,
      method: 'listen',
      params: { pcm: encodePcm(samples) }
    }))
    return (result ?? { speech: false }) as ListenResult
  }

  async transcribe(samples: Float32Array): Promise<string> {
    const result = await this.request((id) => ({
      id,
      method: 'transcribe',
      params: { pcm: encodePcm(samples) }
    }))
    return (result as { text?: string })?.text ?? ''
  }
}
