import type { Utterance } from '@shared/speech'
import type { SpeechSink } from './speech-bus'
import type { NotificationSink } from './notification-sink'
import type { VoiceSidecar } from './voice-sidecar'
import type { ConfigStore } from './config-store'

/**
 * Delivers each utterance over the channels its agent has switched on.
 *
 * Notifications and speech are independent, not alternatives. Speech is
 * transient — miss it and there is no record — while a notification persists.
 * That matters most for questions and blockers, where missing the audio
 * leaves an agent stuck with no trace of why.
 *
 * The bus arbitrates identically regardless; only delivery differs here.
 */

type Delivery = {
  notifications: boolean
  tts: { provider: 'system' | 'kokoro'; voiceId?: string; rate: number } | null
}

export class VoiceSink implements SpeechSink {
  constructor(
    private readonly sidecar: VoiceSidecar,
    private readonly notifications: NotificationSink,
    private readonly store: ConfigStore
  ) {}

  async speak(text: string, options: { signal: AbortSignal; utterance: Utterance }): Promise<void> {
    const { utterance, signal } = options
    const delivery = await this.deliveryFor(utterance.agentId)

    if (!delivery) {
      // The agent could not be read at all. Notify rather than drop it — a
      // message the user never receives is the outcome worth avoiding.
      await this.notifications.speak(text, options)
      return
    }

    // Sent first so the durable record exists before the transient one, and
    // so it still lands if speech then fails.
    if (delivery.notifications) {
      await this.notifications.speak(text, options)
    }

    if (!delivery.tts) return

    if (!this.sidecar.isAvailable) {
      await this.notifyIfNotAlready(delivery, text, options)
      return
    }

    // Preemption and barge-in abort mid-utterance; the sidecar kills the
    // player process, which is what makes stopping immediate.
    const onAbort = (): void => {
      void this.sidecar.stopSpeaking()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      // The provider must be forwarded, not just read: without it the sidecar
      // falls back to system synthesis and an agent configured for a neural
      // voice silently speaks with the platform one instead.
      await this.sidecar.speak(text, {
        provider: delivery.tts.provider,
        voiceId: delivery.tts.voiceId,
        rate: delivery.tts.rate
      })
    } catch {
      // Speech failed. Fall back so the message still arrives — but never
      // after a deliberate interrupt, which would resurrect exactly what the
      // user just silenced.
      if (!signal.aborted) await this.notifyIfNotAlready(delivery, text, options)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  notify(utterances: Utterance[]): void {
    this.notifications.notify(utterances)
  }

  /**
   * Speech failed and notifications are switched off, so this is the only
   * remaining channel. A one-off delivery failure is a different thing from
   * the routine notifications the user opted out of.
   */
  private async notifyIfNotAlready(
    delivery: Delivery,
    text: string,
    options: { signal: AbortSignal; utterance: Utterance }
  ): Promise<void> {
    if (!delivery.notifications) await this.notifications.speak(text, options)
  }

  /** Reads live config so an agent's settings apply without a restart. */
  private async deliveryFor(agentId: string): Promise<Delivery | null> {
    try {
      const { config } = await this.store.read(agentId)

      return {
        notifications: config.notifications,
        tts: config.tts.enabled
          ? {
              provider: config.tts.voice.provider,
              // An empty system id falls through to the platform default; a
              // Kokoro id names a specific speaker, resolved in the sidecar.
              voiceId: config.tts.voice.id || undefined,
              rate: config.tts.rate
            }
          : null
      }
    } catch {
      return null
    }
  }
}
