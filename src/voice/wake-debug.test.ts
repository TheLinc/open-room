import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recordWakeSegment, wakeDebugDir } from './wake-debug'

describe('recordWakeSegment', () => {
  it('writes nothing unless the folder exists', async () => {
    process.env.OPEN_ROOM_HOME = await mkdtemp(join(tmpdir(), 'wake-debug-'))
    await recordWakeSegment(new Float32Array(1600), { speechMs: 0 })
    expect(await readdir(process.env.OPEN_ROOM_HOME)).toEqual([])
  })

  it('writes the segment as a WAV and a log line once the folder exists', async () => {
    process.env.OPEN_ROOM_HOME = await mkdtemp(join(tmpdir(), 'wake-debug-'))
    await mkdir(wakeDebugDir())

    await recordWakeSegment(new Float32Array(16_000).fill(0.5), {
      speechMs: 640,
      text: 'Hey Eric'
    })

    const log = JSON.parse(await readFile(join(wakeDebugDir(), 'log.jsonl'), 'utf8'))
    expect(log).toMatchObject({ seconds: 1, speechMs: 640, text: 'Hey Eric' })
    const wav = await readFile(join(wakeDebugDir(), log.file))
    expect(wav.length).toBe(44 + 16_000 * 2)
    expect(wav.readInt16LE(44)).toBe(Math.round(0.5 * 32767))
  })
})
