import type { Agent } from '@shared/agent'
import { colorHexFor } from '@shared/agent-colors'
import { captureTarget } from '@shared/awaiting'
import { decodePcm } from '@shared/pcm'
import type { AppSettings } from '@shared/settings'
import { holdMsFor, type OverlayState } from '@shared/voice-input'
import {
  IDLE_CAPTURE,
  reduce,
  type CaptureCommand,
  type CaptureEvent,
  type CaptureState
} from './voice-input'

/**
 * Coordinates one voice interaction, from hotkey to dispatched prompt.
 *
 * The reducer decides; this executes. Keeping the two apart is what lets every
 * decision about a capture be tested without a microphone, a window or a
 * subprocess — none of which this file can avoid touching.
 */

export type VoiceControllerDeps = {
  overlay: { send: (state: OverlayState) => void; hide: () => void }
  sidecar: { transcribe: (samples: Float32Array) => Promise<string> }
  /** `AgentSupervisor.send` takes the Agent object, not an id. */
  supervisor: {
    send: (
      agent: Agent,
      text: string,
      images: never[],
      options: { byVoice: true }
    ) => Promise<{ ok: true; queued?: boolean } | { ok: false; message: string }>
  }
  /** Answers a side question from the conversation without joining it. */
  sideQuestions: {
    ask: (
      agent: Agent,
      question: string
    ) => Promise<{ ok: true; answer: string } | { ok: false; message: string }>
  }
  readSettings: () => Promise<AppSettings>
  listAgents: () => Promise<Agent[]>
  isModelInstalled: () => Promise<boolean>
  /** Resolves false when the OS denied the microphone. */
  ensureMicrophoneAccess: () => Promise<boolean>
  /** Whatever the main window currently has selected. */
  selectedAgentId: () => string | null
  /** The agent most recently left waiting on a spoken question, if any. */
  awaitingAgentId: () => string | null
  conversationTitleFor: (agentId: string) => Promise<string>
  startCapture: () => void
  stopCapture: () => void
  discardCapture: () => void
  registerEscape: (handler: () => void) => void
  unregisterEscape: () => void
}

/** How long an error line stays up before dismissing itself. */
const ERROR_HOLD_MS = 2000

/** Grace period after the pointer leaves a held bubble. */
const UNHOVER_HOLD_MS = 800
/** Extra time a "queued behind the current task" line stays readable. */
const QUEUED_HOLD_EXTRA_MS = 2000

export class VoiceController {
  private state: CaptureState = IDLE_CAPTURE
  private agents: Agent[] = []
  private titles = new Map<string, string>()
  private dismissTimer: NodeJS.Timeout | null = null
  private hovered = false

  constructor(private readonly deps: VoiceControllerDeps) {}

  /**
   * The hotkey fired. `agentId` is null for the global binding, which means
   * whichever agent the main window has selected.
   */
  async onTrigger(agentId: string | null, options: { aside?: boolean } = {}): Promise<void> {
    // Press-again ends a capture. The reducer ignores a `trigger` during one —
    // there is no sane arbitration between two captures — so the translation
    // happens here, before any precondition is re-checked. Re-checking them
    // would put an await between the keypress and the stop for no reason.
    if (this.state.phase === 'listening') {
      this.apply({ type: 'stopRequested' })
      return
    }

    const settings = await this.deps.readSettings()
    // Either path justifies a capture: hotkeys only exist with push-to-talk
    // on, and a wake match arrives here too — gating on the push-to-talk
    // flag alone made wake-only mode hear its name and refuse to listen.
    if (!settings.voiceInputEnabled && !settings.wakeWordEnabled) {
      this.apply({ type: 'blocked', message: 'Voice input is turned off' })
      return
    }

    if (!(await this.deps.isModelInstalled())) {
      this.apply({ type: 'blocked', message: 'No speech model installed' })
      return
    }

    if (!(await this.deps.ensureMicrophoneAccess())) {
      this.apply({ type: 'blocked', message: 'Microphone access was denied' })
      return
    }

    this.agents = await this.deps.listAgents()
    // The global hotkey goes to the agent waiting on a reply before the one
    // the main window has selected; the pill names it before anyone speaks.
    const target = captureTarget({
      explicit: agentId,
      awaiting: this.deps.awaitingAgentId(),
      selected: this.deps.selectedAgentId()
    })
    if (!target || !this.agents.some((agent) => agent.config.id === target)) {
      this.apply({ type: 'blocked', message: 'No agent selected' })
      return
    }

    // Resolved before the overlay opens: the conversation has to be on screen
    // before anyone speaks, which is the entire safeguard against a spoken
    // message landing somewhere unexpected.
    this.titles.set(target, await this.deps.conversationTitleFor(target))

    this.apply({ type: 'trigger', agentId: target, aside: options.aside === true })
  }

  /**
   * A prompt the wake listener heard whole ("hey Atlas, run the tests").
   *
   * It used to go straight to the supervisor with nothing on screen, so a
   * prompt queued behind a running turn looked like nothing had happened.
   * Now it takes the same dispatched or asking path as a capture, pill
   * included. No microphone precondition applies: the words are already
   * here, and the wake listener only runs when wake words are on.
   */
  async onSpoken(agentId: string, text: string, aside: boolean): Promise<void> {
    this.agents = await this.deps.listAgents()
    if (!this.agents.some((agent) => agent.config.id === agentId)) return
    this.titles.set(agentId, await this.deps.conversationTitleFor(agentId))
    this.apply({ type: 'spoken', agentId, text, aside })
  }

  /** A finished capture, straight from the overlay. */
  onAudioBase64(pcm: string): Promise<void> {
    return this.onAudio(decodePcm(pcm))
  }

  async onAudio(samples: Float32Array): Promise<void> {
    this.apply({ type: 'audioReady' })

    try {
      const text = await this.deps.sidecar.transcribe(samples)
      this.apply({ type: 'transcript', text })
    } catch (error) {
      this.apply({
        type: 'failed',
        message: error instanceof Error ? error.message : 'Transcription failed'
      })
    }
  }

  /** What the overlay observed, or Escape. */
  onEvent(event: CaptureEvent): void {
    this.apply(event)
  }

  /**
   * Hover pauses dismissal.
   *
   * Without this the bubble vanishes while you are reading the expansion you
   * reached for, which makes the hover affordance worse than useless.
   */
  setHovered(hovered: boolean): void {
    this.hovered = hovered
    if (hovered) this.clearDismiss()
    else this.scheduleDismiss(UNHOVER_HOLD_MS)
  }

  dispose(): void {
    this.clearDismiss()
  }

  private apply(event: CaptureEvent): void {
    const { state, commands } = reduce(this.state, event)
    this.state = state

    for (const command of commands) this.run(command)
    this.deps.overlay.send(this.overlayState())
    this.scheduleDismiss()
  }

  private run(command: CaptureCommand): void {
    switch (command) {
      case 'start-audio':
        this.deps.startCapture()
        // Escape exists only for the life of a capture: the overlay is
        // `focusable: false` and can never receive a keypress itself, and
        // holding the key globally would swallow it for every other app.
        this.deps.registerEscape(() => this.apply({ type: 'cancelRequested' }))
        break

      case 'stop-audio':
        this.deps.stopCapture()
        this.deps.unregisterEscape()
        break

      case 'discard-audio':
        this.deps.discardCapture()
        this.deps.unregisterEscape()
        break

      case 'dispatch':
        void this.dispatch(this.state.agentId, this.state.transcript)
        break
      case 'ask':
        void this.ask(this.state.agentId, this.state.transcript)
        break

      case 'hide':
        this.deps.overlay.hide()
        break

      case 'transcribe':
        // `onAudio` is already awaiting the sidecar; the command exists so the
        // reducer can say what should happen without knowing who does it.
        break
    }
  }

  /**
   * Sends the transcript down the same path as typing, so it renders in the
   * pane as an ordinary user message.
   */
  private async dispatch(agentId: string | null, text: string): Promise<void> {
    const agent = this.agents.find((candidate) => candidate.config.id === agentId)
    if (!agent) return

    // Marked as spoken so the agent acknowledges aloud; a typed prompt has
    // the pane for that.
    const result = await this.deps.supervisor.send(agent, text, [], { byVoice: true })

    // A tick over a prompt that never reached an agent is the one outcome
    // worse than showing the failure.
    if (!result.ok) this.apply({ type: 'failed', message: result.message })
    // A tick over a prompt that is waiting behind a two-minute task is the
    // next worst: say so, since the pane that shows the queue is hidden.
    else if (result.queued) this.apply({ type: 'queued' })
  }

  /** Answers the transcript as a side question, spoken and shown, never sent. */
  private async ask(agentId: string | null, question: string): Promise<void> {
    const agent = this.agents.find((candidate) => candidate.config.id === agentId)
    if (!agent) return

    const result = await this.deps.sideQuestions.ask(agent, question)
    if (result.ok) this.apply({ type: 'answered', text: result.answer })
    else this.apply({ type: 'failed', message: result.message })
  }

  /** The dispatched bubble and error lines dismiss themselves; nothing else does. */
  private scheduleDismiss(override?: number): void {
    this.clearDismiss()
    if (this.hovered) return

    const { phase } = this.state
    const holds = phase === 'dispatched' || phase === 'answered' || phase === 'error'
    if (!holds) return

    // An answer is read, not glanced at, so it holds for its own length; a
    // queued prompt carries a second line that needs the same courtesy.
    const ms =
      override ??
      (phase === 'dispatched'
        ? holdMsFor(this.state.transcript) + (this.state.queued ? QUEUED_HOLD_EXTRA_MS : 0)
        : phase === 'answered'
          ? holdMsFor(this.state.answer)
          : ERROR_HOLD_MS)

    this.dismissTimer = setTimeout(() => this.apply({ type: 'dismiss' }), ms)
  }

  private clearDismiss(): void {
    if (this.dismissTimer) clearTimeout(this.dismissTimer)
    this.dismissTimer = null
  }

  private overlayState(): OverlayState {
    const agent = this.agents.find((candidate) => candidate.config.id === this.state.agentId)

    return {
      phase: this.state.phase,
      agentId: this.state.agentId,
      agentName: agent?.config.name ?? '',
      // `config.color` is an identity colour *id*, not a hex string.
      agentColor: colorHexFor(agent?.config.color ?? ''),
      conversationTitle: this.state.agentId ? (this.titles.get(this.state.agentId) ?? '') : '',
      transcript: this.state.transcript,
      message: this.state.message,
      aside: this.state.aside,
      queued: this.state.queued,
      answer: this.state.answer
    }
  }
}
