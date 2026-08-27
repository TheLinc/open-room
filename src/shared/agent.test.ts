import { describe, expect, it } from 'vitest'
import { agentConfigSchema, agentNameSchema, createDefaultAgent, slugifyAgentName } from './agent'

const validConfig = {
  id: 'atlas',
  name: 'Atlas',
  color: 'amber',
  model: 'claude-sonnet-5',
  workspacePath: 'C:/projects/ci'
}

describe('slugifyAgentName', () => {
  it('lowercases so names cannot collide on case-insensitive filesystems', () => {
    expect(slugifyAgentName('Atlas')).toBe('atlas')
    expect(slugifyAgentName('ATLAS')).toBe('atlas')
  })

  it('replaces spaces and punctuation with hyphens', () => {
    expect(slugifyAgentName('Sky Blue')).toBe('sky-blue')
    expect(slugifyAgentName("O'Brien")).toBe('obrien')
  })

  it('does not leave leading or trailing hyphens', () => {
    expect(slugifyAgentName('  Atlas  ')).toBe('atlas')
    expect(slugifyAgentName('-Atlas-')).toBe('atlas')
  })
})

describe('agentNameSchema', () => {
  it('accepts ordinary names', () => {
    for (const name of ['Atlas', 'Sky Blue', "O'Brien", 'Agent-7']) {
      expect(agentNameSchema.safeParse(name).success).toBe(true)
    }
  })

  it('rejects names that cannot start a wake phrase', () => {
    for (const name of ['', 'A', '7Up', '  ', '@tlas']) {
      expect(agentNameSchema.safeParse(name).success).toBe(false)
    }
  })

  it('rejects names longer than 32 characters', () => {
    expect(agentNameSchema.safeParse('A'.repeat(33)).success).toBe(false)
  })
})

describe('agentConfigSchema', () => {
  it('fills defaults so a minimal config is usable', () => {
    const parsed = agentConfigSchema.parse(validConfig)
    expect(parsed.permissionMode).toBe('default')
    expect(parsed.allowedTools).toEqual([])
    expect(parsed.disallowedTools).toEqual([])
    expect(parsed.persistSession).toBe(true)
    expect(parsed.tts).toEqual({ enabled: false })
    expect(parsed.mcpServers).toEqual({})
  })

  it('rejects an unknown model rather than silently defaulting', () => {
    const result = agentConfigSchema.safeParse({ ...validConfig, model: 'gpt-4' })
    expect(result.success).toBe(false)
  })

  it('accepts auto as a standing permission mode', () => {
    const result = agentConfigSchema.safeParse({ ...validConfig, permissionMode: 'auto' })
    expect(result.success).toBe(true)
  })

  it('never accepts bypassPermissions as a permission mode', () => {
    const result = agentConfigSchema.safeParse({
      ...validConfig,
      permissionMode: 'bypassPermissions'
    })
    expect(result.success).toBe(false)
  })

  it('requires a voice when TTS is enabled', () => {
    expect(
      agentConfigSchema.safeParse({ ...validConfig, tts: { enabled: true, rate: 1 } }).success
    ).toBe(false)

    expect(
      agentConfigSchema.safeParse({
        ...validConfig,
        tts: { enabled: true, rate: 1, voice: { provider: 'kokoro', id: 'af_heart' } }
      }).success
    ).toBe(true)
  })

  it('bounds the TTS rate', () => {
    const withRate = (rate: number) =>
      agentConfigSchema.safeParse({
        ...validConfig,
        tts: { enabled: true, rate, voice: { provider: 'system', id: 'Samantha' } }
      }).success

    expect(withRate(0.4)).toBe(false)
    expect(withRate(1)).toBe(true)
    expect(withRate(2.1)).toBe(false)
  })

  it('accepts both stdio and remote MCP server shapes', () => {
    const result = agentConfigSchema.safeParse({
      ...validConfig,
      mcpServers: {
        local: { command: 'npx', args: ['-y', 'some-server'] },
        remote: { type: 'http', url: 'https://example.com/mcp' }
      }
    })
    expect(result.success).toBe(true)
  })

  it('preserves unknown MCP keys instead of stripping them', () => {
    const parsed = agentConfigSchema.parse({
      ...validConfig,
      mcpServers: { local: { command: 'npx', futureOption: true } }
    })
    expect(parsed.mcpServers.local).toMatchObject({ futureOption: true })
  })

  it('rejects an MCP server missing both command and url', () => {
    const result = agentConfigSchema.safeParse({
      ...validConfig,
      mcpServers: { broken: { args: ['x'] } }
    })
    expect(result.success).toBe(false)
  })
})

describe('createDefaultAgent', () => {
  it('produces a config that validates', () => {
    const agent = createDefaultAgent('Atlas', 'C:/projects/ci', 'amber')
    expect(agentConfigSchema.safeParse(agent.config).success).toBe(true)
    expect(agent.config.id).toBe('atlas')
  })

  it('defaults to read-only tools so a new agent cannot write unprompted', () => {
    const agent = createDefaultAgent('Atlas', 'C:/projects/ci', 'amber')
    expect(agent.config.allowedTools).not.toContain('Write')
    expect(agent.config.allowedTools).not.toContain('Bash')
    expect(agent.config.permissionMode).toBe('default')
  })

  it('includes speak and worklog guidance in the starter context', () => {
    const agent = createDefaultAgent('Atlas', 'C:/projects/ci', 'amber')
    expect(agent.context).toContain('speak')
    expect(agent.context).toContain('WORKLOG.md')
  })
})
