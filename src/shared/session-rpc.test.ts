import { describe, expect, it } from 'vitest'
import { decodeLines, encodeLine } from './session-rpc'

describe('session-rpc codec', () => {
  it('round-trips one message per line', () => {
    const wire = encodeLine({ id: 1, method: 'list' }) + encodeLine({ id: 2, result: [] })
    expect(decodeLines(wire)).toEqual({
      messages: [
        { id: 1, method: 'list' },
        { id: 2, result: [] }
      ],
      rest: ''
    })
  })

  it('keeps a partial trailing line for the next read', () => {
    const wire = encodeLine({ id: 1 }) + '{"id":2,"res'
    expect(decodeLines(wire)).toEqual({ messages: [{ id: 1 }], rest: '{"id":2,"res' })
  })

  it('skips a line that is not JSON rather than failing the stream', () => {
    expect(decodeLines('garbage\n' + encodeLine({ id: 3 })).messages).toEqual([{ id: 3 }])
  })
})
