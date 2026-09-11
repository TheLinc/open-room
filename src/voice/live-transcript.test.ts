import { describe, expect, it } from 'vitest'
import { LiveTranscript, agree, cutPoint, normalizeWord, words } from './live-transcript'

describe('normalizeWord', () => {
  it('ignores case and punctuation so a comma settling later does not un-commit a word', () => {
    expect(normalizeWord('Atlas,')).toBe('atlas')
    expect(normalizeWord('"live".')).toBe('live')
  })
})

describe('agree', () => {
  it('commits the words two consecutive decodes agree on, keeping the newer spelling', () => {
    const result = agree(
      ['Atlas', 'open', 'the', 'settings'],
      ['Atlas,', 'open', 'the', 'settings', 'dialog,'],
      0
    )
    expect(result.committed).toEqual(['Atlas,', 'open', 'the', 'settings'])
    expect(result.tentative).toEqual(['dialog,'])
  })

  it('never uncommits: a respelled committed word stays committed, and agreement carries on past it', () => {
    const result = agree(['Atlas', 'open', 'the'], ['At last', 'opened', 'the', 'door'], 2)
    expect(result.committed).toEqual(['At last', 'opened', 'the'])
    expect(result.tentative).toEqual(['door'])
  })

  it('stops committing at the first disagreement past the committed words', () => {
    const result = agree(['run', 'the', 'test'], ['run', 'the', 'tests', 'now'], 0)
    expect(result.committed).toEqual(['run', 'the'])
    expect(result.tentative).toEqual(['tests', 'now'])
  })

  it('commits nothing on the first decode, since there is nothing to agree with', () => {
    const result = agree([], ['Atlas.'], 0)
    expect(result.committed).toEqual([])
    expect(result.tentative).toEqual(['Atlas.'])
  })
})

describe('words', () => {
  it('splits on whitespace and drops empties', () => {
    expect(words('  Hey  Juno,\nrun ')).toEqual(['Hey', 'Juno,', 'run'])
  })
})

describe('cutPoint', () => {
  const rate = 16_000
  function audio(seconds: number, quietFrom: number, quietTo: number): Float32Array {
    const out = new Float32Array(seconds * rate)
    for (let i = 0; i < out.length; i += 1) {
      const t = i / rate
      out[i] = t >= quietFrom && t < quietTo ? 0.001 : 0.3 * Math.sin(i / 7)
    }
    return out
  }

  it('is null while the window is short', () => {
    expect(cutPoint(audio(8, 4, 4.5), { sampleRate: rate })).toBeNull()
  })

  it('cuts in the quietest stretch, never inside the last three seconds', () => {
    const cut = cutPoint(audio(16, 9, 9.6), { sampleRate: rate })
    expect(cut).not.toBeNull()
    expect(cut! / rate).toBeGreaterThan(9)
    expect(cut! / rate).toBeLessThan(9.6)
  })

  it('still cuts a window with no silence in it, since holding it forever costs more', () => {
    const cut = cutPoint(audio(16, 0, 0), { sampleRate: rate })
    expect(cut).not.toBeNull()
    expect(cut! / rate).toBeLessThanOrEqual(13)
    expect(cut! / rate).toBeGreaterThanOrEqual(4)
  })
})

describe('LiveTranscript', () => {
  it('shows sealed text as committed and carries agreement across decodes', () => {
    const live = new LiveTranscript()
    live.apply(['Atlas', 'open'])
    expect(live.view()).toEqual({ committed: '', tentative: 'Atlas open' })
    live.apply(['Atlas,', 'open', 'the'])
    expect(live.view()).toEqual({ committed: 'Atlas, open', tentative: 'the' })
    live.seal(['Atlas,', 'open', 'the', 'settings.'])
    expect(live.view()).toEqual({ committed: 'Atlas, open the settings.', tentative: '' })
    live.apply(['Then', 'archive'])
    expect(live.view()).toEqual({
      committed: 'Atlas, open the settings.',
      tentative: 'Then archive'
    })
  })

  it('builds the final text from the sealed windows and the last decode', () => {
    const live = new LiveTranscript()
    live.seal(['One', 'two.'])
    expect(live.finish('Three four.')).toBe('One two. Three four.')
    expect(new LiveTranscript().finish('  ')).toBe('')
  })
})
