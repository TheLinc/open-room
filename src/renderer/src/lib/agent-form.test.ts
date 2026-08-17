import { describe, expect, it } from 'vitest'
import { agentConfigSchema, CLAUDE_CODE_TOOLS, createDefaultAgent } from '@shared/agent'
import { parseMcpServers, toAgent, toFormValues, toolPermissionOf } from './agent-form'

const agent = () => createDefaultAgent('Atlas', 'C:/projects/ci', 'amber')

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
