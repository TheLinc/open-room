import { describe, expect, it } from 'vitest'
import { agentConfigSchema, CLAUDE_CODE_TOOLS, createDefaultAgent } from '@shared/agent'
import {
  agentFormSchema,
  parseMcpServers,
  resetFormValues,
  toAgent,
  toFormValues,
  setAllToolPermissions,
  toolPermissionOf,
  uniformToolPermission
} from './agent-form'

const agent = () => createDefaultAgent('Atlas', 'C:/projects/ci', 'amber')

describe('quick-select over every tool', () => {
  const tools = ['Read', 'Bash', 'Write'] as const

  it('sets every listed tool to the one permission', () => {
    expect(setAllToolPermissions(tools, 'allow')).toEqual({
      Read: 'allow',
      Bash: 'allow',
      Write: 'allow'
    })
  })

  it('reports the shared permission when every tool agrees', () => {
    expect(uniformToolPermission(tools, setAllToolPermissions(tools, 'deny'))).toBe('deny')
  })

  it('treats a missing entry as ask, which is what the row shows', () => {
    expect(uniformToolPermission(tools, { Read: 'ask' })).toBe('ask')
  })

  it('reports nothing shared once one row differs', () => {
    expect(uniformToolPermission(tools, { Read: 'allow', Bash: 'allow', Write: 'ask' })).toBeNull()
  })

  it('reports nothing for an empty tool list', () => {
    expect(uniformToolPermission([], {})).toBeNull()
  })
})

describe('toolPermissionOf', () => {
  it('reports ask for tools in neither list, which is the default', () => {
    expect(toolPermissionOf('Bash', [], [])).toBe('ask')
  })

  it('reports allow and deny from their lists', () => {
    expect(toolPermissionOf('Read', ['Read'], [])).toBe('allow')
    expect(toolPermissionOf('Bash', [], ['Bash'])).toBe('deny')
  })

  it('resolves a contradictory config to the restrictive reading', () => {
    expect(toolPermissionOf('Bash', ['Bash'], ['Bash'])).toBe('deny')
  })
})

describe('form round trip', () => {
  it('survives config → form → config unchanged', () => {
    const original = agent()
    const values = toFormValues(original, CLAUDE_CODE_TOOLS)
    const rebuilt = toAgent(values, original.config.id)

    expect(rebuilt.config).toEqual(original.config)
    expect(rebuilt.context).toBe(original.context)
  })

  it('keeps the id fixed across a rename so the directory is not orphaned', () => {
    const original = agent()
    const values = { ...toFormValues(original, CLAUDE_CODE_TOOLS), name: 'Juniper' }
    const rebuilt = toAgent(values, original.config.id)

    expect(rebuilt.config.id).toBe('atlas')
    expect(rebuilt.config.name).toBe('Juniper')
  })

  it('derives an id when creating a new agent', () => {
    const values = { ...toFormValues(agent(), CLAUDE_CODE_TOOLS), name: 'Sky Blue' }
    expect(toAgent(values).config.id).toBe('sky-blue')
  })

  it('omits optional fields rather than writing empty strings', () => {
    const values = toFormValues(agent(), CLAUDE_CODE_TOOLS)
    const config = toAgent(values, 'atlas').config

    expect('effort' in config).toBe(false)
    expect('fallbackModel' in config).toBe(false)
    expect('hotkey' in config).toBe(false)
  })

  it('produces a config that passes the persisted schema', () => {
    const values = {
      ...toFormValues(agent(), CLAUDE_CODE_TOOLS),
      effort: 'high' as const,
      fallbackModel: 'claude-haiku-4-5',
      ttsEnabled: true,
      voiceProvider: 'kokoro' as const,
      voiceId: 'af_heart',
      rate: 1.2
    }

    expect(agentConfigSchema.safeParse(toAgent(values, 'atlas').config).success).toBe(true)
  })

  it('drops the voice entirely when TTS is switched off', () => {
    const values = { ...toFormValues(agent(), CLAUDE_CODE_TOOLS), ttsEnabled: false }
    expect(toAgent(values, 'atlas').config.tts).toEqual({ enabled: false })
  })

  it('maps tool permissions onto the two persisted lists', () => {
    const values = {
      ...toFormValues(agent(), CLAUDE_CODE_TOOLS),
      toolPermissions: { Read: 'allow' as const, Bash: 'deny' as const, Write: 'ask' as const }
    }
    const config = toAgent(values, 'atlas').config

    expect(config.allowedTools).toEqual(['Read'])
    expect(config.disallowedTools).toEqual(['Bash'])
    // "ask" is the absence of an entry in either list.
    expect(config.allowedTools).not.toContain('Write')
    expect(config.disallowedTools).not.toContain('Write')
  })
})

describe('agent form and WSL', () => {
  it('maps an empty distro to a host agent and a name to a WSL agent', () => {
    const values = {
      ...toFormValues(createDefaultAgent('Atlas', 'C:/work', 'cyan'), []),
      wslDistro: ''
    }
    expect(toAgent(values, 'atlas').config.wsl).toBe(null)
    const wsl = { ...values, wslDistro: 'Ubuntu', workspacePath: '/home/u/proj' }
    expect(toAgent(wsl, 'atlas').config.wsl).toEqual({ distro: 'Ubuntu' })
  })

  it('requires a Linux workspace path when a distro is set', () => {
    const base = toFormValues(createDefaultAgent('Atlas', 'C:/work', 'cyan'), [])
    const result = agentFormSchema.safeParse({
      ...base,
      wslDistro: 'Ubuntu',
      workspacePath: 'C:/work'
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['workspacePath'])
      expect(result.error.issues[0].message).toBe(
        'Use a Linux path inside the distro, like /home/you/project'
      )
    }
    expect(
      agentFormSchema.safeParse({ ...base, wslDistro: 'Ubuntu', workspacePath: '/home/u' }).success
    ).toBe(true)
    expect(
      agentFormSchema.safeParse({ ...base, wslDistro: '', workspacePath: 'C:/work' }).success
    ).toBe(true)
  })
})

describe('parseMcpServers', () => {
  it('treats empty input as no servers', () => {
    expect(parseMcpServers('')).toEqual({ ok: true, value: {} })
    expect(parseMcpServers('   ')).toEqual({ ok: true, value: {} })
  })

  it('accepts stdio and remote shapes', () => {
    const result = parseMcpServers(
      JSON.stringify({
        local: { command: 'npx', args: ['-y', 'server'] },
        remote: { type: 'http', url: 'https://example.com/mcp' }
      })
    )
    expect(result.ok).toBe(true)
  })

  it('reports the reason for invalid JSON', () => {
    const result = parseMcpServers('{ nope')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0)
  })

  it('rejects a top-level array', () => {
    const result = parseMcpServers('[]')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('object')
  })

  it('rejects a server missing both command and url', () => {
    const result = parseMcpServers(JSON.stringify({ broken: { args: [] } }))
    expect(result.ok).toBe(false)
  })

  it('round trips through the form as formatted JSON', () => {
    const withServers = agent()
    withServers.config.mcpServers = { local: { command: 'npx' } }

    const values = toFormValues(withServers, CLAUDE_CODE_TOOLS)
    expect(values.mcpServersJson).toContain('npx')
    expect(toAgent(values, 'atlas').config.mcpServers).toEqual({ local: { command: 'npx' } })
  })
})

describe('resetFormValues', () => {
  const tools = ['Read', 'Bash'] as const
  const customised = {
    ...toFormValues(agent(), tools),
    avatar: 'loop' as const,
    context: '# Atlas. Runs CI.',
    wslDistro: 'Ubuntu',
    workspacePath: '/home/me/ci',
    model: 'claude-opus-5' as const,
    permissionMode: 'plan' as const,
    toolPermissions: { Read: 'deny' as const, Bash: 'allow' as const },
    hotkey: 'CommandOrControl+Alt+A',
    ttsEnabled: true,
    worktrees: true
  }

  it('puts every setting back to what a new agent gets', () => {
    const reset = resetFormValues(customised, tools)
    const fresh = toFormValues(agent(), tools)
    expect(reset.model).toBe(fresh.model)
    expect(reset.permissionMode).toBe('default')
    expect(reset.toolPermissions).toEqual(fresh.toolPermissions)
    expect(reset.hotkey).toBe('')
    expect(reset.ttsEnabled).toBe(false)
    expect(reset.worktrees).toBe(false)
  })

  it('keeps who the agent is and where it works', () => {
    expect(resetFormValues(customised, tools)).toMatchObject({
      name: 'Atlas',
      color: 'amber',
      avatar: 'loop',
      context: '# Atlas. Runs CI.',
      workspacePath: '/home/me/ci',
      wslDistro: 'Ubuntu'
    })
  })

  it('passes the form schema', () => {
    expect(agentFormSchema.safeParse(resetFormValues(customised, tools)).success).toBe(true)
  })
})
