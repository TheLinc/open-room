import { describe, expect, it } from 'vitest'
import type { Agent, AgentConfig } from '@shared/agent'
import { agentQueryOptions } from './agent-options'
import { SPEAK_TOOL_NAME, VOICE_SERVER_NAME } from './speak-tool'

/**
 * These options decide what an agent can reach and whose account it bills.
 * Every failure they guard is silent: the agent still runs, still answers,
 * and still looks correct.
 */

const voiceServer = { type: 'sdk', name: VOICE_SERVER_NAME } as never

function agent(overrides: Partial<AgentConfig> = {}): Agent {
  return {
    config: {
      id: 'atlas',
      name: 'Atlas',
      color: 'cyan',
      model: 'claude-sonnet-5',
      workspacePath: 'C:/work',
      mcpServers: {},
      permissionMode: 'default',
      allowedTools: ['Read'],
      disallowedTools: ['Bash'],
      persistSession: true,
      notifications: true,
      tts: { enabled: false },
      ...overrides
    },
    context: '# Role'
  } as unknown as Agent
}

const build = (a: Agent = agent(), resume: string | null = null) =>
  agentQueryOptions(a, resume, voiceServer, undefined)

describe('agentQueryOptions isolation', () => {
  it('loads no filesystem settings', () => {
    // Omitting this loads user, project and local settings, which handed an
    // agent configured with three tools 73 of them and eight MCP servers.
    // Nothing else in the app would notice it coming back.
    expect(build().settingSources).toEqual([])
  })

  it('gives the agent only its own MCP servers plus the voice one', () => {
    const options = build(agent({ mcpServers: { docs: { type: 'stdio', command: 'x' } } as never }))

    expect(Object.keys(options.mcpServers ?? {}).sort()).toEqual(['docs', VOICE_SERVER_NAME])
  })

  it('strips ANTHROPIC_API_KEY, which would bill API credits instead', () => {
    // SDK auth precedence puts the key above the subscription, so leaving it
    // in charges the wrong account while working perfectly.
    expect(build().env).not.toHaveProperty('ANTHROPIC_API_KEY')
  })
})

describe('agentQueryOptions permissions', () => {
  it('auto-approves speaking without touching the other tools', () => {
    // Prompting to say a sentence aloud would stall the whole turn behind a
    // dialog asking permission to speak.
    expect(build().allowedTools).toEqual(['Read', SPEAK_TOOL_NAME])
  })

  it('passes the deny list through unchanged', () => {
    expect(build().disallowedTools).toEqual(['Bash'])
  })

  it('never sets bypassPermissions from config', () => {
    expect(build().permissionMode).toBe('default')
    expect(build(agent({ permissionMode: 'plan' })).permissionMode).toBe('plan')
  })
})

describe('agentQueryOptions conversation', () => {
  it('resumes a persisted conversation when one is selected', () => {
    expect(build(agent(), 'session-1').resume).toBe('session-1')
  })

  it('never pairs resume with an ephemeral session', () => {
    // The SDK cannot resume a session it did not persist, so the pairing is
    // not merely useless — it is invalid.
    expect(build(agent({ persistSession: false }), 'session-1').resume).toBeUndefined()
  })

  it('sets no title', () => {
    // `title` lands in both customTitle and summary, so every conversation
    // would carry the same name and the switcher would be useless.
    expect(build()).not.toHaveProperty('title')
  })
})

describe('agentQueryOptions optional model settings', () => {
  it('omits effort and fallback rather than sending undefined', () => {
    const options = build()
    expect(options).not.toHaveProperty('effort')
    expect(options).not.toHaveProperty('fallbackModel')
  })

  it('forwards them when the agent sets them', () => {
    const options = build(agent({ effort: 'high', fallbackModel: 'claude-haiku-4-5' }))
    expect(options.effort).toBe('high')
    expect(options.fallbackModel).toBe('claude-haiku-4-5')
  })

  it('augments the Claude Code preset rather than replacing it', () => {
    expect(build().systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: '# Role'
    })
  })
})

describe('session overrides', () => {
  it('uses the config when there are none', () => {
    const options = agentQueryOptions(agent({ effort: 'low' }), null, voiceServer, undefined)

    expect(options.model).toBe('claude-sonnet-5')
    expect(options.effort).toBe('low')
    expect(options.permissionMode).toBe('default')
  })

  it('applies them at session start, not one turn late', () => {
    // The control methods only exist once a session is live, so an override
    // set before the first prompt would otherwise be silently ignored for
    // exactly the turn the user set it for.
    const options = agentQueryOptions(agent(), null, voiceServer, undefined, {
      model: 'claude-opus-5',
      effort: 'xhigh',
      permissionMode: 'plan'
    })

    expect(options.model).toBe('claude-opus-5')
    expect(options.effort).toBe('xhigh')
    expect(options.permissionMode).toBe('plan')
  })

  it('overrides the config effort rather than merging with it', () => {
    const options = agentQueryOptions(agent({ effort: 'max' }), null, voiceServer, undefined, {
      effort: 'low'
    })

    expect(options.effort).toBe('low')
  })

  it('leaves effort off entirely when neither names one', () => {
    expect('effort' in agentQueryOptions(agent(), null, voiceServer, undefined, {})).toBe(false)
  })
})
