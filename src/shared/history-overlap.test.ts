import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from './agent-runtime'
import { trimOverlap } from './history-overlap'

let seq = 0
function entry(message: unknown): TranscriptEntry {
  seq += 1
  return { agentId: 'a', seq, receivedAt: 0, message }
}
const prompt = (text: string, uuid?: string): TranscriptEntry =>
  entry({ type: 'user', uuid, message: { role: 'user', content: text } })
const persistedPrompt = (text: string, uuid: string): TranscriptEntry =>
  entry({ type: 'user', uuid, message: { role: 'user', content: [{ type: 'text', text }] } })
const assistant = (uuid: string): TranscriptEntry =>
  entry({ type: 'assistant', uuid, message: { role: 'assistant', content: [] } })
const result = (): TranscriptEntry => entry({ type: 'result', subtype: 'success' })

describe('trimOverlap', () => {
  it('leaves history alone when there are no live entries', () => {
    const history = [persistedPrompt('hi', 'u1'), assistant('a1')]
    expect(trimOverlap(history, [])).toBe(history)
  })

  it('leaves history alone when the live turn is not in it', () => {
    const history = [persistedPrompt('old', 'u1'), assistant('a1')]
    const live = [prompt('new'), assistant('a2'), result()]
    expect(trimOverlap(history, live)).toBe(history)
  })

  it('cuts history at the first assistant message the live list also holds', () => {
    const history = [
      persistedPrompt('old', 'u1'),
      assistant('a1'),
      persistedPrompt('again', 'u2'),
      assistant('a2'),
      assistant('a3')
    ]
    const live = [prompt('again'), assistant('a2'), assistant('a3'), result()]
    expect(trimOverlap(history, live)).toEqual(history.slice(0, 2))
  })

  it('drops the prompt that opened the overlapping turn, which live emitted without a uuid', () => {
    const history = [
      persistedPrompt('old', 'u1'),
      assistant('a1'),
      persistedPrompt('q', 'u2'),
      assistant('a2')
    ]
    const live = [prompt('q'), assistant('a2')]
    expect(trimOverlap(history, live)).toEqual(history.slice(0, 2))
  })

  it('keeps a preceding prompt when the live list starts mid-turn', () => {
    // The head of the live list was dropped by MAX_RETAINED_ENTRIES, so its
    // first entry is an assistant message and its prompt is only on disk.
    const history = [persistedPrompt('q', 'u1'), assistant('a1'), assistant('a2')]
    const live = [assistant('a2')]
    expect(trimOverlap(history, live)).toEqual(history.slice(0, 2))
  })

  it('drops a just-sent prompt that is already on disk but has no reply yet', () => {
    const history = [persistedPrompt('old', 'u1'), assistant('a1'), persistedPrompt('now', 'u2')]
    const live = [prompt('now')]
    expect(trimOverlap(history, live)).toEqual(history.slice(0, 2))
  })

  it('does not match an unkeyed prompt against an older identical one', () => {
    const history = [persistedPrompt('continue', 'u1'), assistant('a1')]
    const live = [prompt('continue')]
    // The last persisted entry is an assistant reply, so this prompt has not
    // reached disk; nothing overlaps.
    expect(trimOverlap(history, live)).toBe(history)
  })

  it('matches a persisted prompt by uuid when the live one carries it', () => {
    const history = [assistant('a1'), persistedPrompt('q', 'u2'), assistant('a2')]
    const live = [prompt('q', 'u2'), assistant('a2')]
    expect(trimOverlap(history, live)).toEqual(history.slice(0, 1))
  })

  it('returns an empty history when the live list covers all of it', () => {
    const history = [persistedPrompt('q', 'u1'), assistant('a1')]
    const live = [prompt('q'), assistant('a1'), result()]
    expect(trimOverlap(history, live)).toEqual([])
  })
})
