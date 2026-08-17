import { describe, expect, it } from 'vitest'
import { decodePcm, encodePcm } from './pcm'

describe('pcm encoding', () => {
  it('round-trips samples unchanged', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123456])

    expect(Array.from(decodePcm(encodePcm(samples)))).toEqual(Array.from(samples))
  })

  it('is far smaller than the JSON array it replaces', () => {
    const samples = new Float32Array(16_000)
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 20)

    // A second of audio as a JSON array of floats dwarfs the audio itself.
    expect(encodePcm(samples).length).toBeLessThan(JSON.stringify(Array.from(samples)).length / 2)
  })

  it('handles an empty buffer', () => {
    expect(decodePcm(encodePcm(new Float32Array(0))).length).toBe(0)
  })

  it('survives a full-length utterance without truncation', () => {
    // 30s at 16kHz — the capture hard cap.
    const samples = new Float32Array(16_000 * 30)
    samples[samples.length - 1] = 0.75

    const decoded = decodePcm(encodePcm(samples))

    expect(decoded.length).toBe(samples.length)
    expect(decoded[decoded.length - 1]).toBeCloseTo(0.75)
  })

  it('preserves a view that does not start at its buffer origin', () => {
    // Worklet output is often a subarray; encoding the whole backing buffer
    // would silently prepend audio that was never captured.
    const backing = new Float32Array([9, 9, 0.25, -0.25])
    const view = backing.subarray(2)

    expect(Array.from(decodePcm(encodePcm(view)))).toEqual([0.25, -0.25])
  })
})
