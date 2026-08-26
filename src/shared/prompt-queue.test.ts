import { describe, expect, it } from 'vitest'
import {
  drain,
  queueActionForResult,
  shouldQueue,
  summarise,
  without,
  type QueuedPrompt
} from './prompt-queue'

const p = (id: string): QueuedPrompt => ({ id, text: `say ${id}`, images: [] })

describe('shouldQueue', () => {
  it('queues while the agent is working or starting', () => {
    expect(shouldQueue('working')).toBe(true)
    expect(shouldQueue('starting')).toBe(true)
  })

  it('sends immediately when the agent is ready, idle, or in error', () => {
    // An error state is left by sending, not by waiting.
    expect(shouldQueue('ready')).toBe(false)
    expect(shouldQueue('idle')).toBe(false)
    expect(shouldQueue('error')).toBe(false)
  })
})

describe('drain', () => {
  it('takes the oldest prompt and leaves the rest in order', () => {
    expect(drain([p('a'), p('b'), p('c')])).toEqual({ next: p('a'), rest: [p('b'), p('c')] })
  })

  it('yields nothing from an empty queue', () => {
    expect(drain([])).toEqual({ next: null, rest: [] })
  })
})

describe('without', () => {
  it('removes one prompt by id and ignores an unknown id', () => {
    expect(without([p('a'), p('b')], 'a')).toEqual([p('b')])
    expect(without([p('a')], 'zzz')).toEqual([p('a')])
  })
})

describe('summarise', () => {
  it('strips image data down to a count for the renderer', () => {
    const withImage: QueuedPrompt = {
      id: 'x',
      text: 'look',
      images: [{ name: 'a.png', mediaType: 'image/png', data: 'AAAA' }]
    }
    expect(summarise([withImage])).toEqual([{ id: 'x', text: 'look', imageCount: 1 }])
  })
})

describe('queueActionForResult', () => {
  it('dispatches the next prompt on an ordinary successful turn', () => {
    expect(
      queueActionForResult({ isCommandResult: false, isError: false, wasInterrupted: false })
    ).toBe('dispatch')
  })

  it('dispatches after a locally-run command result', () => {
    expect(
      queueActionForResult({ isCommandResult: true, isError: false, wasInterrupted: false })
    ).toBe('dispatch')
  })

  it('clears the queue on an error', () => {
    expect(
      queueActionForResult({ isCommandResult: false, isError: true, wasInterrupted: false })
    ).toBe('clear')
  })

  it('clears the queue on an interrupt', () => {
    expect(
      queueActionForResult({ isCommandResult: false, isError: false, wasInterrupted: true })
    ).toBe('clear')
  })

  it('clears the queue when a command result is also interrupted', () => {
    expect(
      queueActionForResult({ isCommandResult: true, isError: false, wasInterrupted: true })
    ).toBe('clear')
  })
})
