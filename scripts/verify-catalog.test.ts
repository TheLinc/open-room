import { describe, expect, it } from 'vitest'
import { renderHashes, type FileRecord } from './verify-catalog'

const record = (key: string, sha256: string, sizeBytes: number): FileRecord => ({
  key,
  sha256,
  sizeBytes
})

describe('renderHashes', () => {
  it('emits a record keyed by model and file name', () => {
    const source = renderHashes([record('whisper-tiny-en/config.json', 'aa11', 1234)])

    expect(source).toContain("'whisper-tiny-en/config.json': {")
    expect(source).toContain("sha256: 'aa11'")
    expect(source).toContain('sizeBytes: 1234')
  })

  it('marks the file as generated so nobody hand-edits it', () => {
    expect(renderHashes([])).toMatch(/GENERATED/)
  })

  it('still type-checks as an empty record when nothing was verified', () => {
    expect(renderHashes([])).toContain('MODEL_HASHES: Record<string, ModelHash> = {}')
  })

  it('sorts by key so regenerating produces no spurious diff', () => {
    const source = renderHashes([
      record('whisper-tiny-en/z.json', 'zz', 2),
      record('whisper-base-en/a.json', 'aa', 1)
    ])

    expect(source.indexOf('whisper-base-en/a.json')).toBeLessThan(
      source.indexOf('whisper-tiny-en/z.json')
    )
  })

  it('stays inside the formatter’s column limit', () => {
    const source = renderHashes([
      record(
        'whisper-tiny-en/onnx/decoder_model_merged.onnx',
        '33581ce4a48f9a59dad036a3939a24f290e0756e05387b977fe6f613460b495e',
        118552291
      )
    ])

    expect(source.split('\n').filter((line) => line.length > 100)).toEqual([])
  })

  it('refuses a record with an empty hash rather than writing a useless entry', () => {
    expect(() => renderHashes([record('whisper-tiny-en/a.json', '', 1)])).toThrow(/hash/i)
  })

  it('refuses a zero size, which would make isInstalled always true', () => {
    expect(() => renderHashes([record('whisper-tiny-en/a.json', 'aa', 0)])).toThrow(/size/i)
  })
})
