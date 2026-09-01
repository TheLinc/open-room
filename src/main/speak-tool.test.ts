import { describe, expect, it } from 'vitest'
import { SPEAK_CALLS_PER_TURN } from '@shared/speech'
import { claimSpeechSlot, newTurnSpeechState, recordAsk, SPEAK_TOOL_NAME } from './speak-tool'

describe('recordAsk', () => {
  it('keeps a question or blocker as what the agent is waiting on', () => {
    const turn = newTurnSpeechState()
    expect(turn.asked).toBe(null)
    recordAsk(turn, 'question', 'Ship it?')
    expect(turn.asked).toBe('Ship it?')
    recordAsk(turn, 'blocker', 'Tests are failing, want me to fix them?')
    expect(turn.asked).toBe('Tests are failing, want me to fix them?')
  })

  it('ignores progress and done, and leaves an earlier ask standing', () => {
    const turn = newTurnSpeechState()
    recordAsk(turn, 'question', 'Ship it?')
    recordAsk(turn, 'progress', 'Halfway there.')
    recordAsk(turn, 'done', 'Finished.')
    expect(turn.asked).toBe('Ship it?')
  })
})

describe('claimSpeechSlot', () => {
  it('allows up to the per-turn budget', () => {
    const turn = newTurnSpeechState()
    for (let i = 0; i < SPEAK_CALLS_PER_TURN; i++) {
      expect(claimSpeechSlot(turn).allowed).toBe(true)
    }
    expect(turn.calls).toBe(SPEAK_CALLS_PER_TURN)
  })

  it('refuses overflow instead of dropping it silently', () => {
    const turn = newTurnSpeechState()
    for (let i = 0; i < SPEAK_CALLS_PER_TURN; i++) claimSpeechSlot(turn)

    const overflow = claimSpeechSlot(turn)
    expect(overflow.allowed).toBe(false)
    // The model must be told, so it can save its budget rather than repeat
    // into a void it cannot observe.
    if (!overflow.allowed) expect(overflow.reason).toMatch(/not spoken/i)
  })

  it('does not increment the count once the budget is spent', () => {
    const turn = newTurnSpeechState()
    for (let i = 0; i < SPEAK_CALLS_PER_TURN + 5; i++) claimSpeechSlot(turn)
    expect(turn.calls).toBe(SPEAK_CALLS_PER_TURN)
  })

  it('records that the agent spoke, which suppresses the silence fallback', () => {
    const turn = newTurnSpeechState()
    expect(turn.spoke).toBe(false)
    claimSpeechSlot(turn)
    expect(turn.spoke).toBe(true)
  })

  it('starts every turn with a fresh budget', () => {
    const turn = newTurnSpeechState()
    expect(turn.calls).toBe(0)
    expect(turn.spoke).toBe(false)
  })
})

describe('SPEAK_TOOL_NAME', () => {
  it('matches the SDK namespacing the permission flow will see', () => {
    // Auto-approval keys off this exact string; a mismatch would stall every
    // turn behind a dialog asking permission to speak.
    expect(SPEAK_TOOL_NAME).toBe('mcp__openroom-voice__speak')
  })
})
