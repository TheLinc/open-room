import { describe, expect, it } from 'vitest'
import {
  commandListUpdate,
  filterCommands,
  isCommandResult,
  isSyntheticAssistant,
  parseCommand,
  pickAction,
  submitAction,
  visibleCommands,
  type SlashCommandInfo
} from './slash-commands'

const cmd = (name: string, description = '', argumentHint = ''): SlashCommandInfo => ({
  name,
  description,
  argumentHint
})

describe('parseCommand', () => {
  it('splits a leading slash into name and arguments', () => {
    expect(parseCommand('/compact keep the auth notes')).toEqual({
      name: 'compact',
      args: 'keep the auth notes'
    })
  })

  it('returns an empty args string for a bare command', () => {
    expect(parseCommand('/usage')).toEqual({ name: 'usage', args: '' })
  })

  it('treats a bare slash as no command', () => {
    expect(parseCommand('/')).toBeNull()
  })

  it('treats prose as no command', () => {
    expect(parseCommand('what does /usage do?')).toBeNull()
  })

  it('treats a doubled slash as literal text', () => {
    expect(parseCommand('//not a command')).toBeNull()
  })

  it('treats a slash after leading whitespace as literal text', () => {
    expect(parseCommand('  /usage')).toBeNull()
  })

  it('treats a slash-prefixed path as no command', () => {
    expect(parseCommand('/usr/bin/env')).toBeNull()
  })
})

describe('visibleCommands', () => {
  it('keeps the daily session commands', () => {
    const list = ['clear', 'compact', 'context', 'usage', 'rename'].map((n) => cmd(n))
    expect(visibleCommands(list, []).map((c) => c.name)).toEqual([
      'clear',
      'compact',
      'context',
      'rename',
      'usage'
    ])
  })

  it('drops commands that belong to the CLI, not the app', () => {
    const list = ['init', 'config', 'mcp', 'heapdump', 'fast', '__remote-workflow', 'compact'].map(
      (n) => cmd(n)
    )
    expect(visibleCommands(list, []).map((c) => c.name)).toEqual(['compact'])
  })

  it('drops commands the header controls already own', () => {
    const list = ['model', 'effort', 'usage'].map((n) => cmd(n))
    expect(visibleCommands(list, []).map((c) => c.name)).toEqual(['usage'])
  })

  it('drops commands the init message marks as terminal-bound', () => {
    const list = ['doctor', 'color', 'usage'].map((n) => cmd(n))
    expect(visibleCommands(list, ['doctor', 'color']).map((c) => c.name)).toEqual(['usage'])
  })

  it('keeps skills it has never heard of', () => {
    const list = [cmd('code-review'), cmd('my-team-thing')]
    expect(visibleCommands(list, []).map((c) => c.name)).toEqual(['code-review', 'my-team-thing'])
  })

  it('sorts session commands before skills, alphabetically within each', () => {
    const list = [cmd('verify'), cmd('usage'), cmd('code-review'), cmd('compact')]
    expect(visibleCommands(list, []).map((c) => c.name)).toEqual([
      'compact',
      'usage',
      'code-review',
      'verify'
    ])
  })
})

describe('filterCommands', () => {
  const list = [cmd('compact'), cmd('context'), cmd('code-review'), cmd('usage')]

  it('returns everything for an empty query', () => {
    expect(filterCommands(list, '')).toEqual(list)
  })

  it('matches by prefix first, then by substring', () => {
    expect(filterCommands(list, 'co').map((c) => c.name)).toEqual([
      'compact',
      'context',
      'code-review'
    ])
    expect(filterCommands(list, 'view').map((c) => c.name)).toEqual(['code-review'])
  })

  it('is case-insensitive', () => {
    expect(filterCommands(list, 'US').map((c) => c.name)).toEqual(['usage'])
  })

  it('returns nothing for a query that matches no command', () => {
    expect(filterCommands(list, 'zzz')).toEqual([])
  })
})

describe('isSyntheticAssistant', () => {
  it('is true for local command output, which the CLI stamps with a synthetic model', () => {
    expect(isSyntheticAssistant({ type: 'assistant', message: { model: '<synthetic>' } })).toBe(
      true
    )
  })

  it('is false for a reply from a real model', () => {
    expect(
      isSyntheticAssistant({ type: 'assistant', message: { model: 'claude-haiku-4-5' } })
    ).toBe(false)
  })

  it('is false for anything that is not an assistant message', () => {
    expect(isSyntheticAssistant({ type: 'user', message: { model: '<synthetic>' } })).toBe(false)
    expect(isSyntheticAssistant(null)).toBe(false)
  })
})

describe('isCommandResult', () => {
  it('is true for the result a local command produces: no model turn, no API time', () => {
    expect(isCommandResult({ type: 'result', num_turns: 0, duration_api_ms: 0 })).toBe(true)
  })

  it('is false for a result that came from the model', () => {
    expect(isCommandResult({ type: 'result', num_turns: 1, duration_api_ms: 812 })).toBe(false)
  })

  it('is false for a non-result message', () => {
    expect(isCommandResult({ type: 'assistant', num_turns: 0 })).toBe(false)
  })
})

describe('submitAction', () => {
  const known = [cmd('compact'), cmd('usage')]

  it('sends prose untouched', () => {
    expect(submitAction('what is /usage?', known)).toEqual({ kind: 'send' })
  })

  it('sends a known command', () => {
    expect(submitAction('/compact focus on auth', known)).toEqual({ kind: 'send' })
  })

  it('refuses an unknown command rather than passing it off as prose', () => {
    expect(submitAction('/compct', known)).toEqual({ kind: 'reject', name: 'compct' })
  })

  it('sends anything before the command list has loaded', () => {
    expect(submitAction('/compct', [])).toEqual({ kind: 'send' })
  })
})

describe('pickAction', () => {
  it('fills in a command that takes arguments, leaving the cursor after a space', () => {
    expect(pickAction(cmd('compact', '', '<instructions>'))).toEqual({
      kind: 'fill',
      draft: '/compact '
    })
  })

  it('runs a command that takes none on the spot', () => {
    expect(pickAction(cmd('usage'))).toEqual({ kind: 'run', text: '/usage' })
  })
})

describe('commandListUpdate', () => {
  const state = { loaded: false, terminal: [] as string[] }

  it('asks for the list on the first init and records the terminal-bound names', () => {
    expect(
      commandListUpdate(state, {
        type: 'system',
        subtype: 'init',
        terminal_slash_commands: ['doctor', 'color']
      })
    ).toEqual({ state: { loaded: true, terminal: ['doctor', 'color'] }, action: { kind: 'fetch' } })
  })

  it('does not ask again on the init the CLI re-sends every turn', () => {
    const loaded = { loaded: true, terminal: ['doctor'] }
    expect(commandListUpdate(loaded, { type: 'system', subtype: 'init' })).toEqual({
      state: { loaded: true, terminal: [] },
      action: null
    })
  })

  it('replaces the list when the CLI pushes a change, filtered like the original', () => {
    const loaded = { loaded: true, terminal: ['doctor'] }
    const result = commandListUpdate(loaded, {
      type: 'system',
      subtype: 'commands_changed',
      commands: [cmd('doctor'), cmd('mcp'), cmd('compact'), cmd('new-skill')]
    })
    expect(result.state).toBe(loaded)
    expect(result.action).toEqual({
      kind: 'replace',
      commands: [cmd('compact'), cmd('new-skill')]
    })
  })

  it('ignores every other message', () => {
    const loaded = { loaded: true, terminal: [] }
    expect(commandListUpdate(loaded, { type: 'assistant' })).toEqual({
      state: loaded,
      action: null
    })
    expect(commandListUpdate(loaded, { type: 'system', subtype: 'status' })).toEqual({
      state: loaded,
      action: null
    })
  })
})
