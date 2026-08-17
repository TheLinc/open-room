import type { Utterance } from '@shared/speech'
import type { SpeechSink } from './speech-bus'
import type { NotificationSink } from './notification-sink'
import type { VoiceSidecar } from './voice-sidecar'
import type { ConfigStore } from './config-store'

/**
 * Routes each utterance to speech or to a notification.
 *
 * TTS is opt-in per agent, so a single bus feeds two delivery channels. The
 * bus arbitrates identically either way — only what happens at the end of the
 * lane differs.
 *
 * Falls back to a notification whenever speech cannot happen: the agent has
 * TTS switched off, the sidecar is down, or synthesis failed. A message the
 * user never receives is the one outcome worth avoiding.
 */
export class VoiceSink implements SpeechSink {
  constructor(
    private readonly sidecar: VoiceSidecar,
    private readonly notifications: NotificationSink,
    private readonly store: ConfigStore
  ) {}

  async speak(
    prefixed: string,
    options: { signal: AbortSignal; utterance: Utterance }
  ): Promise<void> {
    const { utterance, signal } = options
    const tts = await this.ttsFor(utterance.agentId)

    if (!tts || !this.sidecar.isAvailable) {
      await this.notifications.speak(prefixed, options)
      return
    }

    // Preemption and barge-in abort mid-utterance; the sidecar kills the
    // player process, which is what makes stopping immediate.
    const onAbort = (): void => {
      void this.sidecar.stopSpeaking()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      await this.sidecar.speak(prefixed, { voiceId: tts.voiceId, rate: tts.rate })
    } catch {
      // Synthesis or playback failed. Say it some other way rather than
      // dropping it — but not if the user deliberately cut it off.
      if (!signal.aborted) await this.notifications.speak(prefixed, options)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  notify(utterances: Utterance[]): void {
    this.notifications.notify(utterances)
  }

  /** Reads live config so an agent's voice settings apply without a restart. */
  private async ttsFor(
    agentId: string
  ): Promise<{ voiceId?: string; rate: number; provider: 'system' | 'kokoro' } | null> {
    try {
      const agent = await this.store.read(agentId)
      if (!agent.config.tts.enabled) return null

      const { voice, rate } = agent.config.tts
      // An empty system id falls through to the platform default; a Kokoro id
      // names a specific speaker and is resolved inside the sidecar.
      return {
        provider: voice.provider,
        voiceId: voice.id || undefined,
        rate
      }
    } catch {
      return null
    }
  }
}
