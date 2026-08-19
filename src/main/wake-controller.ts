import type { Agent } from '@shared/agent'
import type { ListenResult } from '@shared/voice-rpc'
import { echoesPlayback, matchWake } from '@shared/wake'

/**
 * Always-on wake words.
 *
 * The overlay decides what is worth sending; the sidecar decides whether it
 * was speech and what it said; this decides whether it was addressed to an
 * agent. Keeping that last judgement here means it can be tested without a
 * microphone, a model, or a subprocess — which matters, because it is the
 * step that can hand a spoken sentence to something with shell access.
 */

export type WakeControllerDeps = {
  overlay: {
    startWake: () => void
    stopWake: () => void
    muteWake: (muted: boolean) => void
  }
  sidecar: { listen: (samples: Float32Array) => Promise<ListenResult> }
  supervisor: {
    send: (agent: Agent, text: string) => Promise<{ ok: true } | { ok: false; message: string }>
  }
  listAgents: () => Promise<Agent[]>
  /** What the SpeechBus is saying right now, for the echo check. */
  nowSpeaking: () => string | null
  /** A bare "hey <name>" opens a capture instead of sending an empty prompt. */
  startCapture: (agentId: string) => void
}

/**
 * How long after playback ends before listening resumes.
 *
 * The tail of an utterance is still travelling from the speakers to the
 * microphone when the sink reports it finished.
 */
const UNMUTE_DELAY_MS = 300

export class WakeController {
  private listening = false
  private unmuteTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: WakeControllerDeps) {}

  start(): void {
    if (this.listening) return
    this.listening = true
    this.deps.overlay.startWake()
  }

  stop(): void {
    this.listening = false
    this.clearUnmute()
    this.deps.overlay.stopWake()
  }

  get isListening(): boolean {
    return this.listening
  }

  /**
   * Suppresses listening while the app speaks.
   *
   * The second of three self-trigger defences. The first is structural — the
   * SpeechBus emits a bare name and the matcher requires `hey`, so agent
   * speech cannot form a wake phrase at all. The third is `echoesPlayback`,
   * for audio already in flight when this fires.
   */
  setSpeaking(speaking: boolean): void {
    this.clearUnmute()

    if (speaking) {
      this.deps.overlay.muteWake(true)
      return
    }

    this.unmuteTimer = setTimeout(() => {
      this.unmuteTimer = null
      this.deps.overlay.muteWake(false)
    }, UNMUTE_DELAY_MS)
  }

  /** One segment the overlay's gate accepted. */
  async onSegment(samples: Float32Array): Promise<void> {
    if (!this.listening) return

    const result = await this.deps.sidecar.listen(samples)
    if (!result.speech || !result.text?.trim()) return

    // Checked before matching, not after: a transcript that is this app's own
    // voice must not reach the matcher at all.
    const playing = this.deps.nowSpeaking()
    if (playing && echoesPlayback(result.text, playing)) return

    const agents = await this.deps.listAgents()
    const match = matchWake(
      result.text,
      agents.map((agent) => ({ id: agent.config.id, name: agent.config.name }))
    )
    if (!match) return

    // Addressed, but with nothing to do yet. Opening a capture is the useful
    // reading — the user said a name and is about to say what they want.
    if (!match.prompt) {
      this.deps.startCapture(match.agentId)
      return
    }

    const agent = agents.find((candidate) => candidate.config.id === match.agentId)
    if (agent) await this.deps.supervisor.send(agent, match.prompt)
  }

  dispose(): void {
    this.clearUnmute()
  }

  private clearUnmute(): void {
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer)
    this.unmuteTimer = null
  }
}
