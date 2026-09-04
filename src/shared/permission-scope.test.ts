import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { sessionScoped } from './permission-scope'

describe('sessionScoped', () => {
  it('rewrites every suggested rule to the session, wherever the CLI wanted it stored', () => {
    const suggestions: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'echo *' }],
        behavior: 'allow',
        destination: 'localSettings'
      },
      {
        type: 'addRules',
        rules: [{ toolName: 'Edit' }],
        behavior: 'allow',
        destination: 'projectSettings'
      }
    ]
    expect(sessionScoped(suggestions)).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'echo *' }],
        behavior: 'allow',
        destination: 'session'
      },
      { type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'allow', destination: 'session' }
    ])
  })

  it('leaves a rule already scoped to the session as it is', () => {
    const suggestions: PermissionUpdate[] = [
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }
    ]
    expect(sessionScoped(suggestions)).toEqual(suggestions)
  })

  it('keeps only the rules: a mode switch or a directory grant is not what the button offered', () => {
    const suggestions: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'touch same.txt' }],
        behavior: 'allow',
        destination: 'localSettings'
      },
      { type: 'addDirectories', directories: ['C:\\work'], destination: 'session' },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' }
    ]
    expect(sessionScoped(suggestions)).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'touch same.txt' }],
        behavior: 'allow',
        destination: 'session'
      }
    ])
  })

  it('returns undefined for no suggestions, so the caller sends nothing', () => {
    expect(sessionScoped(undefined)).toBeUndefined()
  })
})
