import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@shared/agent-runtime'
import { foldTurns, formatWorked } from './transcript-folds'

let seq = 0
function entry(message: unknown, extra: Partial<TranscriptEntry> = {}): TranscriptEntry {
  seq += 1
  return { agentId: 'atlas', seq, receivedAt: 0, message, ...extra }
}
// A live prompt always carries main's receive stamp; 0 is what persisted
// history entries carry, so the history cases below leave it at 0.
const prompt = (text: string, receivedAt = 0): TranscriptEntry =>
  entry({ type: 'user', message: { role: 'user', content: text } }, { receivedAt })
const assistantText = (text: string): TranscriptEntry =>
  entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const thinking = (): TranscriptEntry =>
  entry({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] }
  })
const toolUse = (): TranscriptEntry =>
  entry({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }]
    }
  })
const toolResult = (): TranscriptEntry =>
  entry({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' }] }
  })
const result = (receivedAt: number, extra: Partial<TranscriptEntry> = {}): TranscriptEntry =>
  entry({ type: 'result', subtype: 'success', is_error: false }, { receivedAt, ...extra })

const kinds = (rows: ReturnType<typeof foldTurns>): string[] =>
  rows.map((row) => (row.kind === 'fold' ? `fold:${row.label}` : row.kind))

describe('foldTurns', () => {
  it('folds everything between the prompt and the final text behind one row', () => {
    const rows = foldTurns(
      [
        prompt('go', 1000),
        thinking(),
        toolUse(),
        toolResult(),
        assistantText('done'),
        result(96_000)
      ],
      { live: true }
    )
    expect(kinds(rows)).toEqual(['entry', 'fold:Worked for 1m 35s', 'entry', 'after'])
    // The three steps and the result row, which would otherwise repeat the
    // fold's own line underneath it.
    const fold = rows[1]
    expect(fold.kind === 'fold' && fold.hidden.length).toBe(4)
    expect(fold.kind === 'fold' && (fold.hidden.at(-1)?.message as { type: string }).type).toBe(
      'result'
    )
  })

  it('carries the turn cost on the fold, since the result row is folded with it', () => {
    const rows = foldTurns(
      [
        prompt('go', 1000),
        toolUse(),
        toolResult(),
        assistantText('done'),
        entry(
          { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0651 },
          {
            receivedAt: 5000
          }
        )
      ],
      { live: true }
    )
    expect(kinds(rows)).toEqual(['entry', 'fold:Worked for 4s · $0.0651', 'entry', 'after'])
  })

  it('never folds a turn that is still running', () => {
    const rows = foldTurns([prompt('go', 1000), thinking(), toolUse()], { live: true })
    expect(kinds(rows)).toEqual(['entry', 'entry', 'entry'])
  })

  it('leaves a turn with nothing to hide alone', () => {
    const rows = foldTurns([prompt('hi', 1000), assistantText('hello'), result(1500)], {
      live: true
    })
    expect(kinds(rows)).toEqual(['entry', 'entry', 'entry'])
  })

  it('folds a tool call that came after the final text too', () => {
    const rows = foldTurns(
      [prompt('go', 1000), assistantText('done'), toolUse(), toolResult(), result(5000)],
      { live: true }
    )
    expect(kinds(rows)).toEqual(['entry', 'entry', 'fold:Worked for 4s', 'after'])
  })

  it('says what happened when the user stopped the turn', () => {
    const rows = foldTurns(
      [prompt('go', 1000), toolUse(), toolResult(), result(13_000, { interrupted: true })],
      { live: true }
    )
    expect(kinds(rows)).toEqual(['entry', 'fold:You stopped after 12s', 'after'])
  })

  it('keeps an errored turn fully visible', () => {
    const errored = entry(
      { type: 'result', subtype: 'error_during_execution', is_error: true },
      { receivedAt: 3000 }
    )
    const rows = foldTurns([prompt('go', 1000), toolUse(), toolResult(), errored], { live: true })
    expect(kinds(rows)).toEqual(['entry', 'entry', 'entry', 'entry'])
  })

  it('folds persisted history at the next prompt, with a duration from timestamps', () => {
    const stamped = (e: TranscriptEntry, timestamp: string): TranscriptEntry => ({
      ...e,
      message: { ...(e.message as object), timestamp }
    })
    const rows = foldTurns(
      [
        stamped(prompt('first'), '2026-09-10T10:00:00.000Z'),
        stamped(toolUse(), '2026-09-10T10:00:05.000Z'),
        stamped(toolResult(), '2026-09-10T10:00:06.000Z'),
        stamped(assistantText('done'), '2026-09-10T10:00:40.000Z'),
        stamped(prompt('second'), '2026-09-10T10:05:00.000Z'),
        stamped(assistantText('again'), '2026-09-10T10:05:02.000Z')
      ],
      { live: false }
    )
    expect(kinds(rows)).toEqual(['entry', 'fold:Worked for 40s', 'entry', 'entry', 'entry'])
  })

  it('says Worked with no time when history carries no timestamps', () => {
    const rows = foldTurns(
      [prompt('first'), toolUse(), toolResult(), assistantText('done'), prompt('second')],
      { live: false }
    )
    expect(kinds(rows)).toEqual(['entry', 'fold:Worked', 'entry', 'entry'])
  })

  it('folds a whole turn that ended without any text', () => {
    const rows = foldTurns([prompt('go', 1000), toolUse(), toolResult(), result(3000)], {
      live: true
    })
    expect(kinds(rows)).toEqual(['entry', 'fold:Worked for 2s', 'after'])
  })
})

describe('formatWorked', () => {
  it('reads like a person would say it', () => {
    expect(formatWorked(800)).toBe('1s')
    expect(formatWorked(12_000)).toBe('12s')
    expect(formatWorked(95_000)).toBe('1m 35s')
    expect(formatWorked(3_725_000)).toBe('1h 2m 5s')
  })
})
