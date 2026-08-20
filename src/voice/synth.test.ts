import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

/**
 * The property under test is a performance one, but it is exact and it is
 * silent when broken: the PowerShell script text must not vary between
 * utterances.
 *
 * Windows scans every distinct script buffer through AMSI before running it
 * and caches the verdict by content, so an unchanging script is scanned once
 * and a script carrying an interpolated temp path is scanned every time —
 * measured at roughly 550ms added to each utterance. Nothing about the audio
 * changes, which is why this needs a test rather than an ear.
 */

const spawned: { args: string[]; env: NodeJS.ProcessEnv | undefined }[] = []

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawned.push({ args, env: options?.env })

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { write: () => void; end: () => void }
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { write: () => {}, end: () => {} }
    queueMicrotask(() => child.emit('close', 0))
    return child
  }
}))

const { SAPI_SCRIPT, sapiEnv, synthesize } = await import('./synth')

/** The base64 payload of `-EncodedCommand`, which is the buffer AMSI hashes. */
function encodedCommand(args: string[]): string {
  return args[args.indexOf('-EncodedCommand') + 1]
}

beforeEach(() => {
  spawned.length = 0
})

describe('SAPI_SCRIPT', () => {
  it('carries no interpolated per-utterance values', () => {
    // A path separator or a drive letter in here means something was baked in.
    expect(SAPI_SCRIPT).not.toMatch(/[A-Za-z]:\\/)
    expect(SAPI_SCRIPT).not.toContain('${')
    expect(SAPI_SCRIPT).toContain('$env:OPEN_ROOM_WAV')
    expect(SAPI_SCRIPT).toContain('$env:OPEN_ROOM_TEXT')
  })
})

describe('sapiEnv', () => {
  it('inverts our rate onto SAPI, where higher is faster', () => {
    // 1 is natural in both. Ours goes up for slower, SAPI's for faster.
    expect(sapiEnv({ rate: 1, file: 'w', textFile: 't' }).OPEN_ROOM_RATE).toBe('0')
    expect(Number(sapiEnv({ rate: 2, file: 'w', textFile: 't' }).OPEN_ROOM_RATE)).toBeLessThan(0)
    expect(Number(sapiEnv({ rate: 0.5, file: 'w', textFile: 't' }).OPEN_ROOM_RATE)).toBeGreaterThan(
      0
    )
  })

  it('clamps to the range SAPI accepts', () => {
    expect(sapiEnv({ rate: 100, file: 'w', textFile: 't' }).OPEN_ROOM_RATE).toBe('-10')
    expect(sapiEnv({ rate: -100, file: 'w', textFile: 't' }).OPEN_ROOM_RATE).toBe('10')
  })

  it('passes an absent voice as empty, which the script treats as the default', () => {
    expect(sapiEnv({ rate: 1, file: 'w', textFile: 't' }).OPEN_ROOM_VOICE).toBe('')
  })
})

describe.runIf(process.platform === 'win32')('synthesize', () => {
  it('sends a byte-identical command for utterances that differ', async () => {
    const first = await synthesize('One utterance.', { rate: 1, provider: 'system' })
    const second = await synthesize('A different one.', {
      rate: 1.5,
      voiceId: 'Microsoft Zira Desktop',
      provider: 'system'
    })

    expect(spawned).toHaveLength(2)
    // Different text, different rate, different voice, different temp path —
    // and still the same script, or the AMSI cache never hits.
    expect(encodedCommand(spawned[1].args)).toBe(encodedCommand(spawned[0].args))

    // The variation has to survive somewhere, and that somewhere is the env.
    expect(spawned[0].env?.OPEN_ROOM_WAV).not.toBe(spawned[1].env?.OPEN_ROOM_WAV)
    expect(spawned[1].env?.OPEN_ROOM_VOICE).toBe('Microsoft Zira Desktop')

    await first.cleanup()
    await second.cleanup()
  })
})
