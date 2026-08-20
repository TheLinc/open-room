import { describe, expect, it } from 'vitest'
import { silentWav } from './warm'

/**
 * The warm-up runs at launch, unprompted, so the one thing it must never do
 * is make a noise. Synthesised audio is discarded rather than played; this
 * clip is the only thing that reaches the speakers, which is why its samples
 * are asserted rather than assumed.
 */

describe('silentWav', () => {
  it('is a WAV a player will accept', () => {
    const wav = silentWav()

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ')
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data')
    // PCM, mono, 16-bit — the shape SoundPlayer and afplay both handle.
    expect(wav.readUInt16LE(20)).toBe(1)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt16LE(34)).toBe(16)
  })

  it('declares sizes that match the bytes actually present', () => {
    // A truthful header matters more than usual here: a player that trusts a
    // wrong length can emit whatever follows in memory as audio.
    const wav = silentWav()
    const dataBytes = wav.readUInt32LE(40)

    expect(wav.length).toBe(44 + dataBytes)
    expect(wav.readUInt32LE(4)).toBe(36 + dataBytes)
    expect(wav.readUInt32LE(28)).toBe(wav.readUInt32LE(24) * 2)
  })

  it('contains nothing but silence', () => {
    const wav = silentWav()
    for (let offset = 44; offset < wav.length; offset += 2) {
      expect(wav.readInt16LE(offset)).toBe(0)
    }
  })

  it('is short, since it exists to be spawned rather than heard', () => {
    const wav = silentWav()
    const seconds = wav.readUInt32LE(40) / wav.readUInt32LE(28)
    expect(seconds).toBeLessThan(0.2)
  })

  it('still produces at least one sample when asked for nothing', () => {
    // A zero-length data chunk is a file some players reject outright, which
    // would turn a warm-up into a spawn that fails instead of priming.
    expect(silentWav(0).readUInt32LE(40)).toBeGreaterThan(0)
  })
})
