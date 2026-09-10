import { describe, expect, it } from 'vitest'
import { speechAllowed, watching } from './attention'

describe('watching', () => {
  it('is true only when the window is focused on that agent', () => {
    expect(watching({ windowFocused: true, selectedAgentId: 'atlas' }, 'atlas')).toBe(true)
    expect(watching({ windowFocused: true, selectedAgentId: 'juno' }, 'atlas')).toBe(false)
    expect(watching({ windowFocused: false, selectedAgentId: 'atlas' }, 'atlas')).toBe(false)
    expect(watching({ windowFocused: true, selectedAgentId: null }, 'atlas')).toBe(false)
  })
})

describe('speechAllowed', () => {
  it('always lets a question or blocker through, watched or not', () => {
    expect(speechAllowed('question', true, false)).toBe(true)
    expect(speechAllowed('blocker', true, false)).toBe(true)
  })

  it('holds done and progress while the user is watching that agent', () => {
    expect(speechAllowed('done', true, false)).toBe(false)
    expect(speechAllowed('progress', true, false)).toBe(false)
  })

  it('speaks done and progress when the user is looking elsewhere', () => {
    expect(speechAllowed('done', false, false)).toBe(true)
    expect(speechAllowed('progress', false, false)).toBe(true)
  })

  it('speaks everything when the user asked to be spoken to regardless', () => {
    expect(speechAllowed('done', true, true)).toBe(true)
    expect(speechAllowed('progress', true, true)).toBe(true)
  })
})
