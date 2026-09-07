import { describe, expect, it } from 'vitest'
import { acknowledgement, openingCandidate, openingLine } from './voice-ack'

describe('openingCandidate', () => {
  const assistant = (content: unknown) => ({ type: 'assistant', message: { content } })

  it('waits past a thinking-only message, which is not the opening', () => {
    expect(openingCandidate(assistant([{ type: 'thinking', thinking: 'hmm' }]))).toEqual({
      kind: 'wait'
    })
  })

  it('offers the first text block', () => {
    expect(
      openingCandidate(
        assistant([
          { type: 'text', text: 'I will run the tests.' },
          { type: 'tool_use', name: 'Bash', input: {} }
        ])
      )
    ).toEqual({ kind: 'text', text: 'I will run the tests.' })
  })

  it('ends the search at a message that opens with a tool call and no text', () => {
    expect(openingCandidate(assistant([{ type: 'tool_use', name: 'Bash', input: {} }]))).toEqual({
      kind: 'tool'
    })
  })

  it('offers a plain string body as text', () => {
    expect(openingCandidate(assistant('On my way.'))).toEqual({ kind: 'text', text: 'On my way.' })
  })
})

describe('acknowledgement', () => {
  it('says the prompt is being acted on', () => {
    expect(acknowledgement({ queued: false })).toBe('On it.')
  })

  it('says the prompt is waiting when the agent was busy', () => {
    expect(acknowledgement({ queued: true })).toBe('Queued, after this task.')
  })
})

describe('openingLine', () => {
  const voiceTurn = { byVoice: true, openingSpoken: false }

  it('speaks a short plain first line from a voice-initiated turn', () => {
    expect(openingLine(voiceTurn, 'I will run the test suite and check the macOS job.')).toBe(
      'I will run the test suite and check the macOS job.'
    )
  })

  it('says nothing for a typed prompt, since the pane shows the reply', () => {
    expect(
      openingLine({ byVoice: false, openingSpoken: false }, 'I will run the tests.')
    ).toBeNull()
  })

  it('speaks only the first line of a turn', () => {
    expect(openingLine({ byVoice: true, openingSpoken: true }, 'Now checking lint.')).toBeNull()
  })

  it('never condenses: a line with structure is left unspoken rather than sent to a model', () => {
    expect(openingLine(voiceTurn, 'Running:\n- tests\n- lint')).toBeNull()
    expect(openingLine(voiceTurn, 'Opening `src/main/index.ts` now.')).toBeNull()
  })

  it('leaves an empty first message unspoken', () => {
    expect(openingLine(voiceTurn, '   ')).toBeNull()
  })
})
