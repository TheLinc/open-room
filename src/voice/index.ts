import {
  decodeMessages,
  encodeMessage,
  type VoiceRequest,
  type VoiceResponse
} from '@shared/voice-rpc'
import { listSystemVoices, synthesize } from './synth'
import { WavPlayer } from './player'

/**
 * The voice sidecar.
 *
 * Runs as a plain Node process outside Electron, on purpose. Audio playback
 * and, later, Silero VAD and whisper.cpp are native or long-running work;
 * keeping them here avoids ABI rebuilds against Electron's Node and keeps DSP
 * off the UI thread. If this process dies, speech degrades to notifications
 * and the app carries on.
 *
 * Speaks line-delimited JSON on stdio. stdout is the protocol channel and
 * carries nothing else — diagnostics go to stderr.
 */

const player = new WavPlayer()

/** The in-flight utterance, so a new one can cancel the one before it. */
let currentSpeech: { cleanup: () => Promise<void> } | null = null

function reply(response: VoiceResponse): void {
  process.stdout.write(encodeMessage(response))
}

async function handle(request: VoiceRequest): Promise<unknown> {
  switch (request.method) {
    case 'ping':
      return 'pong'

    case 'listVoices':
      return listSystemVoices()

    case 'stop':
      player.stop()
      return null

    case 'speak': {
      // A new utterance always supersedes the old one: the bus has already
      // decided this one wins, so playing both would defeat the arbitration.
      player.stop()
      await currentSpeech?.cleanup()
      currentSpeech = null

      const synthesized = await synthesize(request.params.text, {
        voiceId: request.params.voiceId,
        rate: request.params.rate
      })
      currentSpeech = synthesized

      try {
        return await player.play(synthesized.wavPath)
      } finally {
        await synthesized.cleanup()
        if (currentSpeech === synthesized) currentSpeech = null
      }
    }
  }
}

let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  const { messages, rest } = decodeMessages(buffer + chunk)
  buffer = rest

  for (const message of messages) {
    const request = message as VoiceRequest
    // Requests are handled concurrently so a `stop` can land while a `speak`
    // is still playing — serialising them would make interruption impossible.
    void handle(request)
      .then((result) => reply({ id: request.id, ok: true, result }))
      .catch((error) =>
        reply({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      )
  }
})

process.stdin.on('end', () => {
  player.stop()
  process.exit(0)
})

process.on('uncaughtException', (error) => {
  // Report and keep going. Main supervises this process and will restart it
  // if it does die, but a single bad utterance should not take audio down.
  process.stderr.write(`voice sidecar error: ${String(error)}\n`)
})
