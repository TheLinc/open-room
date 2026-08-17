import {
  BURST_THRESHOLD,
  compareUtterances,
  isExpired,
  PRIORITY_RANK,
  SPEAKER_PREFIX_WINDOW_MS,
  type Utterance
} from '@shared/speech'

/**
 * The single global playback lane.
 *
 * Every agent's speech is serialised through one bus. Without it, two agents
 * finishing at the same moment talk over each other, which is unusable — the
 * whole point of speech here is that you are looking at something else.
 *
 * The bus owns arbitration only. It knows nothing about audio, which is what
 * lets the interesting behaviour be tested without a sound device.
 */

export type SpeechSink = {
  /**
   * Speaks the text, resolving when playback finishes.
   *
   * Must stop promptly when the signal aborts — preemption and barge-in both
   * depend on cutting off mid-sentence.
   */
  speak: (text: string, options: { signal: AbortSignal; utterance: Utterance }) => Promise<void>
  /** Collapsed burst overflow, delivered as one notification instead. */
  notify: (utterances: Utterance[]) => void
}

type Playing = {
  utterance: Utterance
  controller: AbortController
}

export class SpeechBus {
  private queue: Utterance[] = []
  private playing: Playing | null = null
  private lastSpeakerId: string | null = null
  private lastSpokeAt = 0

  constructor(
    private readonly sink: SpeechSink,
    private readonly now: () => number = Date.now
  ) {}

  get isSpeaking(): boolean {
    return this.playing !== null
  }

  enqueue(utterance: Utterance): void {
    if (utterance.priority === 'progress') {
      // Only the newest progress from an agent is worth hearing; older ones
      // are describing a state that has already moved on.
      this.queue = this.queue.filter(
        (queued) => !(queued.priority === 'progress' && queued.agentId === utterance.agentId)
      )
    }

    this.queue.push(utterance)
    this.pump()
  }

  /** Stops playback immediately and abandons the queue. */
  bargeIn(): void {
    // Everything queued was written for a moment that has passed — the user
    // is talking now, and replaying it afterwards would be noise.
    this.queue = []
    this.playing?.controller.abort()
  }

  private pump(): void {
    if (this.playing) {
      // Preempt only upward. Equal priority waits its turn, so a burst of
      // completions does not chop itself into fragments.
      const next = this.peek()
      if (next && PRIORITY_RANK[next.priority] > PRIORITY_RANK[this.playing.utterance.priority]) {
        this.playing.controller.abort()
      }
      return
    }

    const utterance = this.take()
    if (!utterance) return

    const controller = new AbortController()
    this.playing = { utterance, controller }

    const text = this.withSpeaker(utterance)
    this.lastSpeakerId = utterance.agentId
    this.lastSpokeAt = this.now()

    void this.sink
      .speak(text, { signal: controller.signal, utterance })
      .catch(() => {
        // A dead audio device must not wedge the lane — the next utterance
        // still gets its turn, and speech degrades to notifications elsewhere.
      })
      .finally(() => {
        this.playing = null
        this.pump()
      })
  }

  /** Highest-priority ready utterance, without removing it. */
  private peek(): Utterance | undefined {
    this.dropExpired()
    return [...this.queue].sort(compareUtterances)[0]
  }

  private take(): Utterance | undefined {
    this.dropExpired()
    if (this.queue.length === 0) return undefined

    const ordered = [...this.queue].sort(compareUtterances)
    const [next, ...rest] = ordered

    // When several agents report at once, speaking them in series buries the
    // important one. Say the top and collapse the rest into one notification.
    if (ordered.length >= BURST_THRESHOLD) {
      this.queue = []
      this.sink.notify(rest)
      return next
    }

    this.queue = rest
    return next
  }

  private dropExpired(): void {
    const now = this.now()
    this.queue = this.queue.filter((utterance) => !isExpired(utterance, now))
  }

  /**
   * Prefixes the agent's name when it is not obvious who is talking.
   *
   * The bare-name form is deliberate: the wake phrase requires a `hey`
   * prefix, so speech output cannot form a valid wake phrase and re-trigger
   * an agent.
   */
  private withSpeaker(utterance: Utterance): string {
    const sameSpeaker = this.lastSpeakerId === utterance.agentId
    const recent = this.now() - this.lastSpokeAt < SPEAKER_PREFIX_WINDOW_MS

    return sameSpeaker && recent ? utterance.text : `${utterance.agentName} — ${utterance.text}`
  }
}
