import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SystemVoice } from '@shared/voice-rpc'

/**
 * Turns text into a WAV file using the operating system's own voices.
 *
 * Synthesis is always to a file, never straight to the speakers, even where
 * the platform offers direct playback. Owning the playback step is what makes
 * an utterance interruptible mid-sentence, which the SpeechBus requires for
 * both preemption and barge-in.
 */

export type Synthesized = {
  wavPath: string
  /** Removes the temporary file; safe to call twice. */
  cleanup: () => Promise<void>
}

const isWindows = process.platform === 'win32'

async function tempWav(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'open-room-tts-'))
  return { dir, file: join(dir, 'utterance.wav') }
}

/** Runs a command to completion, resolving with its stdout. */
function run(
  command: string,
  args: string[],
  options: { input?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))

    if (options.input !== undefined) {
      child.stdin.write(options.input)
      child.stdin.end()
    }
  })
}

/**
 * PowerShell is invoked with a base64-encoded command.
 *
 * Speech text is arbitrary user- and model-generated content, and quoting it
 * into a PowerShell command line is a losing game — apostrophes, quotes and
 * newlines all break it. Encoding sidesteps escaping entirely.
 */
function powershell(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
}

export async function listSystemVoices(): Promise<SystemVoice[]> {
  if (isWindows) {
    const { stdout } = await powershell(
      `Add-Type -AssemblyName System.Speech
       $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
       $s.GetInstalledVoices() | ForEach-Object {
         $i = $_.VoiceInfo
         Write-Output ("{0}|{1}" -f $i.Name, $i.Culture.Name)
       }`
    )

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, locale] = line.split('|')
        return { id: name, label: name, locale }
      })
  }

  // macOS: `say -v ?` lists "Name    locale  # sample sentence".
  const { stdout } = await run('say', ['-v', '?'])
  const voices: SystemVoice[] = []

  for (const line of stdout.split('\n')) {
    const match = /^(.+?)\s{2,}([\w-]+)/.exec(line.trim())
    if (!match) continue
    voices.push({ id: match[1].trim(), label: match[1].trim(), locale: match[2] })
  }

  return voices
}

/**
 * `rate` follows Piper's convention: 1 is natural, higher is slower. Each
 * platform's own scale is mapped onto it so agent config means the same thing
 * everywhere.
 */
export async function synthesize(
  text: string,
  options: { voiceId?: string; rate: number }
): Promise<Synthesized> {
  const { dir, file } = await tempWav()
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    if (isWindows) {
      // SAPI rate is -10..10 with 0 natural. Our scale is inverted (higher =
      // slower), so it is negated on the way in.
      const sapiRate = Math.round(Math.max(-10, Math.min(10, (1 - options.rate) * 10)))
      const textFile = join(dir, 'text.txt')
      await writeFile(textFile, text, 'utf8')

      const selectVoice = options.voiceId
        ? `try { $s.SelectVoice(${quotePs(options.voiceId)}) } catch {}`
        : ''

      const { code, stderr } = await powershell(
        `Add-Type -AssemblyName System.Speech
         $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
         ${selectVoice}
         $s.Rate = ${sapiRate}
         $s.SetOutputToWaveFile(${quotePs(file)})
         $s.Speak([System.IO.File]::ReadAllText(${quotePs(textFile)}, [System.Text.Encoding]::UTF8))
         $s.Dispose()`
      )

      if (code !== 0) throw new Error(stderr.trim() || 'PowerShell synthesis failed')
      return { wavPath: file, cleanup }
    }

    // macOS `say` takes words per minute; 175 is roughly natural.
    const wpm = Math.round(175 / Math.max(0.5, options.rate))
    const args = ['--file-format=WAVE', '--data-format=LEI16@22050', '-r', String(wpm), '-o', file]
    if (options.voiceId) args.push('-v', options.voiceId)

    // Text arrives on stdin so no shell quoting is involved.
    const { code, stderr } = await run('say', [...args, '-f', '-'], { input: text })
    if (code !== 0) throw new Error(stderr.trim() || '`say` synthesis failed')

    return { wavPath: file, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

/** Single-quoted PowerShell literal; the only escape needed is a doubled quote. */
function quotePs(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
