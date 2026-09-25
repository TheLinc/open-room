import { access, appendFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pcmWav } from './warm'

/**
 * Records every wake segment the sidecar is sent, with what was heard.
 *
 * Off unless `<OPEN_ROOM_HOME>/wake-debug/` exists, so it works in an
 * installed build with no flag to pass, and nothing of anyone's voice is
 * written unless they asked for it by making the folder. Each segment lands
 * as a 16 kHz WAV beside one line of `log.jsonl`: how much Silero called
 * speech, and the transcript (absent when the gate rejected it). Matching is
 * deterministic, so `matchWake` can be replayed on the log afterwards.
 */
export function wakeDebugDir(): string {
  return join(process.env.OPEN_ROOM_HOME || join(homedir(), '.open-room'), 'wake-debug')
}

export async function recordWakeSegment(
  samples: Float32Array,
  heard: { speechMs: number; text?: string }
): Promise<void> {
  const dir = wakeDebugDir()
  try {
    await access(dir)
  } catch {
    return
  }

  const at = new Date().toISOString()
  const file = `${at.replace(/[:.]/g, '-')}.wav`
  await writeFile(join(dir, file), pcmWav(samples, 16_000))
  const seconds = Math.round((samples.length / 16_000) * 100) / 100
  await appendFile(join(dir, 'log.jsonl'), `${JSON.stringify({ at, file, seconds, ...heard })}\n`)
}
