import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

/**
 * Playback pays the same AMSI script-scanning cost as synthesis, and it sits
 * on the critical path for both backends — a Kokoro utterance skips the
 * synthesis PowerShell entirely but still plays through this one. Measured to
 * the moment PowerShell was ready to play: 697ms with the path inlined in the
 * script, 155ms with it in the environment.
 */

const spawned: { command: string; args: string[]; env: NodeJS.ProcessEnv | undefined }[] = []

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
    spawned.push({ command, args, env: options?.env })
    const child = new EventEmitter() as EventEmitter & { kill: () => void }
    child.kill = () => child.emit('close', 0)
    return child
  }
}))

const { PLAY_SCRIPT, WavPlayer } = await import('./player')

function encodedCommand(args: string[]): string {
  return args[args.indexOf('-EncodedCommand') + 1]
}

beforeEach(() => {
  spawned.length = 0
})

describe('PLAY_SCRIPT', () => {
  it('reads its file from the environment rather than interpolation', () => {
    expect(PLAY_SCRIPT).toContain('$env:OPEN_ROOM_WAV')
    expect(PLAY_SCRIPT).not.toMatch(/[A-Za-z]:\\/)
    expect(PLAY_SCRIPT).not.toContain('${')
  })
})

describe.runIf(process.platform === 'win32')('WavPlayer', () => {
  it('spawns the same command for different files', () => {
    const player = new WavPlayer()
    void player.play('C:\\one\\utterance.wav')
    player.stop()
    void player.play('C:\\another\\utterance.wav')
    player.stop()

    expect(spawned).toHaveLength(2)
    expect(encodedCommand(spawned[1].args)).toBe(encodedCommand(spawned[0].args))
    expect(spawned[0].env?.OPEN_ROOM_WAV).toBe('C:\\one\\utterance.wav')
    expect(spawned[1].env?.OPEN_ROOM_WAV).toBe('C:\\another\\utterance.wav')
  })

  it('does not lose a path containing a quote, which interpolation had to escape', () => {
    const player = new WavPlayer()
    const awkward = "C:\\it's here\\utterance.wav"
    void player.play(awkward)
    player.stop()

    expect(spawned[0].env?.OPEN_ROOM_WAV).toBe(awkward)
  })
})
