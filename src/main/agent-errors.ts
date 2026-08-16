import type { AgentError, AgentErrorKind } from '@shared/agent-runtime'

/**
 * Builds the environment for a spawned `claude` process.
 *
 * `ANTHROPIC_API_KEY` is stripped deliberately. SDK auth precedence puts it
 * above `CLAUDE_CODE_OAUTH_TOKEN`, so if it exists anywhere in the environment
 * every agent silently bills API credits instead of the user's subscription —
 * the single most expensive mistake this app could make, and invisible while
 * it happens.
 *
 * The SDK's `env` option replaces `process.env` rather than merging, so the
 * child environment has to be assembled explicitly.
 */
export function buildChildEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (key === 'ANTHROPIC_API_KEY') continue
    env[key] = value
  }

  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'open-room'
  return env
}

/** Maps the SDK's assistant-message error codes onto our states. */
export function kindFromAssistantError(error: string): AgentErrorKind {
  switch (error) {
    case 'rate_limit':
      return 'rate-limited'
    case 'overloaded':
      return 'overloaded'
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return 'not-authenticated'
    case 'billing_error':
      return 'billing'
    case 'invalid_request':
    case 'model_not_found':
    case 'max_output_tokens':
    case 'server_error':
      return 'unknown'
    default:
      return 'unknown'
  }
}

const HINTS: Partial<Record<AgentErrorKind, string>> = {
  'cli-missing': 'Install Claude Code with: npm install -g @anthropic-ai/claude-code',
  'not-authenticated': 'Run `claude` in a terminal and sign in, then try again.',
  'workspace-missing': 'Pick a folder that exists in this agent’s settings.',
  'rate-limited': 'Usage limit reached. This clears on its own — try again shortly.',
  overloaded: 'The service is busy. This usually clears within a minute.',
  'usage-limit': 'Your plan’s usage limit is reached. It resets on your billing cycle.',
  billing: 'There is a billing problem on the account Claude Code is signed in to.'
}

export function describeAgentError(kind: AgentErrorKind, message: string): AgentError {
  return { kind, message, ...(HINTS[kind] ? { hint: HINTS[kind] } : {}) }
}

/**
 * Classifies a thrown error from starting or running a session.
 *
 * The SDK surfaces these as plain errors with human-readable text, so pattern
 * matching is the only option. Kept in one place and tested, rather than
 * spread through the supervisor as ad-hoc string checks.
 */
export function classifyThrownError(error: unknown): AgentError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (
    lower.includes('enoent') ||
    lower.includes('command not found') ||
    lower.includes('could not find claude') ||
    lower.includes('claude code not found')
  ) {
    return describeAgentError('cli-missing', message)
  }

  if (
    lower.includes('not logged in') ||
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('please run /login')
  ) {
    return describeAgentError('not-authenticated', message)
  }

  if (lower.includes('rate limit') || lower.includes('429')) {
    return describeAgentError('rate-limited', message)
  }

  if (lower.includes('overloaded') || lower.includes('529')) {
    return describeAgentError('overloaded', message)
  }

  if (lower.includes('usage limit') || lower.includes('quota')) {
    return describeAgentError('usage-limit', message)
  }

  if (lower.includes('credit balance') || lower.includes('billing')) {
    return describeAgentError('billing', message)
  }

  return describeAgentError('crashed', message)
}
