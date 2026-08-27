import { describe, expect, it } from 'vitest'
import { isTransient } from '@shared/agent-runtime'
import { buildChildEnv, classifyThrownError, kindFromAssistantError } from './agent-errors'

describe('buildChildEnv', () => {
  it('strips ANTHROPIC_API_KEY so agents bill the subscription, not credits', () => {
    const env = buildChildEnv({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-secret' })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('keeps the OAuth token, which is the subscription path', () => {
    const env = buildChildEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token' })
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token')
  })

  it('drops undefined values, which the SDK env type disallows', () => {
    const env = buildChildEnv({ DEFINED: 'yes', MISSING: undefined })
    expect('MISSING' in env).toBe(false)
    expect(env.DEFINED).toBe('yes')
  })

  it('identifies the client app', () => {
    expect(buildChildEnv({}).CLAUDE_AGENT_SDK_CLIENT_APP).toBe('open-room')
  })

  it('does not mutate the environment it was given', () => {
    const base = { ANTHROPIC_API_KEY: 'sk-ant-secret' }
    buildChildEnv(base)
    expect(base.ANTHROPIC_API_KEY).toBe('sk-ant-secret')
  })
})

describe('kindFromAssistantError', () => {
  it('separates quota conditions from crashes', () => {
    expect(kindFromAssistantError('rate_limit')).toBe('rate-limited')
    expect(kindFromAssistantError('overloaded')).toBe('overloaded')
  })

  it('maps both auth failures onto not-authenticated', () => {
    expect(kindFromAssistantError('authentication_failed')).toBe('not-authenticated')
    expect(kindFromAssistantError('oauth_org_not_allowed')).toBe('not-authenticated')
  })

  it('maps billing errors distinctly, since waiting will not fix them', () => {
    expect(kindFromAssistantError('billing_error')).toBe('billing')
  })

  it('falls back to unknown for codes it has not seen', () => {
    expect(kindFromAssistantError('some_future_code')).toBe('unknown')
  })
})

describe('classifyThrownError', () => {
  const cases: Array<[string, string]> = [
    ['spawn claude ENOENT', 'cli-missing'],
    ['command not found: claude', 'cli-missing'],
    ['Not logged in. Please run /login', 'not-authenticated'],
    ['401 Unauthorized', 'not-authenticated'],
    ['Rate limit exceeded', 'rate-limited'],
    ['Request failed with status 429', 'rate-limited'],
    ['Server overloaded', 'overloaded'],
    ['Your usage limit has been reached', 'usage-limit'],
    ['Your credit balance is too low', 'billing'],
    ['Something else entirely went wrong', 'crashed']
  ]

  it.each(cases)('classifies %j as %s', (message, expected) => {
    expect(classifyThrownError(new Error(message)).kind).toBe(expected)
  })

  it('handles non-Error throws', () => {
    expect(classifyThrownError('plain string').kind).toBe('crashed')
  })

  it('preserves the original message for display', () => {
    const error = classifyThrownError(new Error('spawn claude ENOENT'))
    expect(error.message).toBe('spawn claude ENOENT')
  })

  it('attaches an actionable hint where one exists', () => {
    expect(classifyThrownError(new Error('spawn claude ENOENT')).hint).toContain('Reinstall')
    expect(classifyThrownError(new Error('Not logged in')).hint).toContain('sign in')
  })
})

describe('isTransient', () => {
  it('treats only self-clearing conditions as worth waiting out', () => {
    expect(isTransient('rate-limited')).toBe(true)
    expect(isTransient('overloaded')).toBe(true)
    expect(isTransient('crashed')).toBe(false)
    expect(isTransient('not-authenticated')).toBe(false)
    expect(isTransient('billing')).toBe(false)
  })
})
