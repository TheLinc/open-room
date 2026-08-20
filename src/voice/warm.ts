import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WavPlayer } from './player'
import { synthesize } from './synth'

/**
 * Runs each PowerShell script once so the first thing an agent says is not the
 * thing that pays for them.
 *
 * There are two separate one-time costs, and neither is the synthesis itself.
 * Measured on a fresh sidecar against its own steady state: synthesis 1384ms
 * against 290ms, and playback 811ms against 261ms of overhead around the clip.
 * Priming with an unrelated PowerShell call absorbed only half the first —
 * 1384ms fell to 830ms — so one cost belongs to the process's first spawn and
 * the other belongs to each distinct script text, which is Defender scanning a
 * buffer it has not seen from this process before.
 *
 * That is why this runs the real `SAPI_SCRIPT` and the real `PLAY_SCRIPT`
 * rather than something cheaper: a different script would warm the spawn and
 * leave both scans to be paid by the user's first sentence.
 *
 * It also has to happen on every sidecar start rather than once per app
 * launch, since the cost follows the process and the sidecar is restarted
 * after a crash.
 */

/** Long enough to be a valid clip, far too short to hear. */
const SILENCE_MS = 40
const SAMPLE_RATE = 22_050

/**
 * A WAV of pure silence.
 *
 * Playback has to be warmed with something audible-in-principle, and the only
 * way to be sure a launch never makes a noise is to control the samples
 * ourselves. Synthesised speech is thrown away instead of played, so it needs
 * no such care.
 */
export function silentWav(ms: number = SILENCE_MS, sampleRate: number = SAMPLE_RATE): Buffer {
  const samples = Math.max(1, Math.round((ms / 1000) * sampleRate))
  const dataBytes = samples * 2
  const buffer = Buffer.alloc(44 + dataBytes)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM header length
  buffer.writeUInt16LE(1, 20) // PCM, uncompressed
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  // The samples themselves are already zero.

  return buffer
}

/**
 * Primes both speech scripts. Silent, and safe to interrupt.
 *
 * A real utterance arriving mid-warm stops the silent playback through the
 * ordinary player, which is the correct outcome — the user's speech wins and
 * the warm has already served its purpose by then.
 */
export async function warmSpeech(player: WavPlayer): Promise<void> {
  // Only Windows shells out for either step, and only Windows scans scripts.
  if (process.platform !== 'win32') return

  // Synthesis: produced and discarded, so nothing can reach the speakers.
  const synthesized = await synthesize('.', { rate: 1, provider: 'system' })
  await synthesized.cleanup()

  const dir = await mkdtemp(join(tmpdir(), 'open-room-warm-'))
  try {
    const file = join(dir, 'silence.wav')
    await writeFile(file, silentWav())
    await player.play(file)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
