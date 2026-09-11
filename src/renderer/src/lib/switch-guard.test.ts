import { describe, expect, it } from 'vitest'
import { switchConfirmCopy, switchNeedsConfirm } from './switch-guard'

describe('switchNeedsConfirm', () => {
  it('asks while a turn runs or the process is starting', () => {
    expect(switchNeedsConfirm('working', 0)).toBe(true)
    expect(switchNeedsConfirm('starting', 0)).toBe(true)
  })

  it('asks while a permission prompt is waiting, whatever the state', () => {
    expect(switchNeedsConfirm('ready', 1)).toBe(true)
  })

  it('switches straight away when the agent is idle or ready', () => {
    expect(switchNeedsConfirm('ready', 0)).toBe(false)
    expect(switchNeedsConfirm('idle', 0)).toBe(false)
    expect(switchNeedsConfirm('error', 0)).toBe(false)
  })
})

describe('switchConfirmCopy', () => {
  it('names the agent, what it is doing, and what the click would do', () => {
    expect(switchConfirmCopy('Janet', 'select', 0)).toEqual({
      line: 'Janet is still working. Stop it and switch?',
      confirm: 'Stop and switch'
    })
    expect(switchConfirmCopy('Janet', 'new', 0)).toEqual({
      line: 'Janet is still working. Stop it and start a new conversation?',
      confirm: 'Stop and start'
    })
    expect(switchConfirmCopy('Janet', 'archive', 0).confirm).toBe('Stop and archive')
    expect(switchConfirmCopy('Janet', 'delete', 0).confirm).toBe('Stop and delete')
  })

  it('says a permission prompt is waiting when one is', () => {
    expect(switchConfirmCopy('Janet', 'select', 1).line).toBe(
      'Janet is waiting for you to answer a permission prompt. Stop it and switch?'
    )
  })
})
