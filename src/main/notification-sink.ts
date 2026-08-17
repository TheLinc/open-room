import { Notification } from 'electron'
import type { Utterance } from '@shared/speech'
import type { SpeechSink } from './speech-bus'

/**
 * Delivers speech as native notifications.
 *
 * Notifications are the default channel — TTS is opt-in per agent, and no
 * audio backend exists until the voice sidecar lands. The bus arbitrates the
 * same way regardless; only delivery changes, which is why the sink is a
 * separate seam.
 *
 * Playback here is effectively instantaneous, so preemption never fires
 * against this sink. That is correct rather than a gap: there is no
 * mid-sentence to interrupt.
 */
export class NotificationSink implements SpeechSink {
  // The bus's speaker-prefixed text is ignored here on purpose: the
  // notification title already names the agent, so "Atlas — done" under a
  // title of "Atlas" would say it twice.
  async speak(_prefixed: string, { utterance }: { utterance: Utterance }): Promise<void> {
    if (!Notification.isSupported()) return

    new Notification({
      title: utterance.agentName,
      body: utterance.text,
      // Questions and blockers are waiting on the user, so they should not
      // silently disappear from the notification centre.
      urgency:
        utterance.priority === 'question' || utterance.priority === 'blocker'
          ? 'critical'
          : 'normal'
    }).show()
  }

  notify(utterances: Utterance[]): void {
    if (!Notification.isSupported() || utterances.length === 0) return

    const names = [...new Set(utterances.map((u) => u.agentName))]
    const who =
      names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names[0]} and ${names.length - 1} others`

    new Notification({
      title: `${utterances.length} more updates`,
      body: `${who} also reported in.`
    }).show()
  }
}
