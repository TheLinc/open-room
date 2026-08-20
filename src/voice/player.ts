import { spawn, type ChildProcess } from 'node:child_process'
import type { SpeakOutcome } from '@shared/voice-rpc'

/**
 * Plays a WAV file, and can stop it mid-sentence.
 *
 * Playback runs in its own short-lived process so that stopping is just
 * killing it. That is the whole reason synthesis writes a file first: the
 * SpeechBus preempts lower-priority speech and barge-in cuts playback the
 * moment the user talks, and neither works against a fire-and-forget
 * "speak this string" API.
 */

type Active = {
  child: ChildProcess
  /** Set before the kill, so `close` can tell a stop from a natural end. */
  stopped: boolean
}

/**
 * The playback script, which must stay byte-identical between calls.
 *
 * Same reasoning as `SAPI_SCRIPT` in `synth.ts`: Windows scans every distinct
 * PowerShell script buffer through AMSI and caches the verdict by content, so
 * embedding the file path made every utterance a fresh scan. Measured to the
 * moment PowerShell is ready to play — 697/695/697ms with the path inlined,
 * against 153/157ms once it moved to the environment.
 *
 * PlaySync blocks for the duration of the clip, which is what makes killing
 * the process an immediate stop.
 */
export const PLAY_SCRIPT = `$p = New-Object System.Media.SoundPlayer $env:OPEN_ROOM_WAV
$p.PlaySync()`

function spawnPlayer(wavPath: string): ChildProcess {
  if (process.platform === 'win32') {
    return spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(PLAY_SCRIPT, 'utf16le').toString('base64')
      ],
      { windowsHide: true, env: { ...process.env, OPEN_ROOM_WAV: wavPath } }
    )
  }

  return spawn('afplay', [wavPath])
}

export class WavPlayer {
  private active: Active | null = null

  get isPlaying(): boolean {
    return this.active !== null
  }

  /**
   * Resolves when playback finishes or is stopped.
   *
   * A stop is an outcome rather than an error — preemption and barge-in are
   * normal, expected endings.
   */
  play(wavPath: string): Promise<SpeakOutcome> {
    this.stop()

    return new Promise<SpeakOutcome>((resolve) => {
      const active: Active = { child: spawnPlayer(wavPath), stopped: false }
      this.active = active

      const settle = (): void => {
        if (this.active === active) this.active = null
        resolve(active.stopped ? 'stopped' : 'completed')
      }

      active.child.on('error', () => {
        // A missing or broken player is not fatal: speech degrades, the lane
        // keeps moving, and notifications still carry the message.
        active.stopped = true
        settle()
      })
      active.child.on('close', settle)
    })
  }

  /** Ends playback immediately. Safe to call when nothing is playing. */
  stop(): void {
    const active = this.active
    if (!active) return

    active.stopped = true
    this.active = null
    active.child.kill()
  }
}
