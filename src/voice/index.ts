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

/**
 * The neural stack is imported on demand.
 *
 * Loading transformers.js pulls in a large wasm phonemizer, which would delay
 * sidecar startup and make even `ping` wait on machinery an agent using system
 * voices never needs.
 */
const kokoroModule = (): Promise<typeof import('./kokoro')> => import('./kokoro')

/** Speech-to-text is loaded the same way, and only when voice input is used. */
const sttModule = (): Promise<typeof import('./stt')> => import('./stt')

/** Last reported weight-download progress, so status can be polled. */
let kokoroProgress: number | undefined
let kokoroError: string | undefined
let sttProgress: number | undefined
let sttError: string | undefined

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

    case 'kokoroStatus': {
      const { isKokoroLoaded } = await kokoroModule()
      return { loaded: isKokoroLoaded(), progress: kokoroProgress, error: kokoroError }
    }

    case 'loadKokoro': {
      kokoroError = undefined
      try {
        const { loadKokoro } = await kokoroModule()
        await loadKokoro((p) => {
          kokoroProgress = p.progress
        })
        kokoroProgress = 1
      } catch (error) {
        kokoroError = error instanceof Error ? error.message : String(error)
        throw error
      }
      return { loaded: true }
    }

    case 'sttStatus': {
      const { isSttLoaded } = await sttModule()
      return { loaded: isSttLoaded(), progress: sttProgress, error: sttError }
    }

    case 'loadStt': {
      sttError = undefined
      try {
        const { loadStt } = await sttModule()
        await loadStt((p) => {
          sttProgress = p
        })
        sttProgress = 1
      } catch (error) {
        sttError = error instanceof Error ? error.message : String(error)
        throw error
      }
      return { loaded: true }
    }

    case 'transcribe': {
      const { transcribe } = await sttModule()
      // Samples arrive base64-encoded: a JSON array of tens of thousands of
      // floats would dwarf the audio it describes.
      const buffer = Buffer.from(request.params.pcm, 'base64')
      const samples = new Float32Array(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      )
      return { text: await transcribe(samples) }
    }

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
        rate: request.params.rate,
        provider: request.params.provider
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
