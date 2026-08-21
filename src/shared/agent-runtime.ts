import type { ContextUsage } from './context-usage'
import type { SessionOverrides } from './session-overrides'

/**
 * Runtime state for a running agent, shared across processes.
 *
 * Kept free of SDK imports so the renderer does not pull in the Agent SDK.
 * Transcript messages cross the boundary as opaque values and are rendered
 * verbatim — see "Chat output is never altered" in CLAUDE.md.
 */

/**
 * Why an agent is not running.
 *
 * Quota conditions are deliberately separate from `crashed`: one is
 * wait-and-retry, the other needs the user to intervene. Collapsing them into
 * a single "error" state is what makes a rate-limited agent look broken.
 */
export type AgentErrorKind =
  | 'cli-missing'
  | 'not-authenticated'
  | 'workspace-missing'
  | 'rate-limited'
  | 'overloaded'
  | 'usage-limit'
  | 'billing'
  | 'crashed'
  | 'unknown'

/** True when waiting is a reasonable response — the condition clears itself. */
export function isTransient(kind: AgentErrorKind): boolean {
  return kind === 'rate-limited' || kind === 'overloaded'
}

export type AgentError = {
  kind: AgentErrorKind
  message: string
  /** What the user can do about it, when there is something. */
  hint?: string
  /** Epoch ms after which a retry is worth attempting. */
  retryAt?: number
}

export type AgentState =
  /** No session; nothing spawned. */
  | 'idle'
  /** Subprocess spawning, session not yet initialised. */
  | 'starting'
  /** Session alive and waiting for input. */
  | 'ready'
  /** Session alive and working on a turn. */
  | 'working'
  /** Session alive but the last turn failed, or no session because start failed. */
  | 'error'

export type AgentUsage = {
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  numTurns: number
}

export const EMPTY_USAGE: AgentUsage = {
  totalCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  numTurns: 0
}

/**
 * Subscription quota, as reported by the SDK's `rate_limit_event`.
 *
 * This is the honest answer to "why did my agent stop", and it only exists
 * for subscription users — which is every Open Room user by design. Worth
 * surfacing rather than leaving buried in the transcript.
 */
export type RateLimitStatus = {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  /** Epoch seconds when the window resets. */
  resetsAt?: number
  rateLimitType?: string
  /**
   * 0–1 fraction of the window consumed.
   *
   * Documented by the SDK but absent from the payloads actually observed, so
   * it renders only when one genuinely arrives. Check a real message before
   * relying on it.
   */
  utilization?: number
  isUsingOverage?: boolean
  /**
   * Whether overflow can roll onto overage. `'rejected'` means it cannot, so
   * reaching the window stops the agent rather than changing how it bills.
   */
  overageStatus?: string
  /** Why overage is unavailable, e.g. `org_level_disabled_until`. */
  overageDisabledReason?: string
}

export type AgentRuntime = {
  agentId: string
  state: AgentState
  /** Present once the session has initialised; used to resume it later. */
  sessionId: string | null
  /**
   * The conversation the next prompt continues.
   *
   * Set without a session being live — selecting a conversation only decides
   * what to resume; nothing spawns until the user actually says something.
   * Null means the next prompt starts a fresh conversation.
   */
  activeConversationId: string | null
  error: AgentError | null
  usage: AgentUsage
  rateLimit: RateLimitStatus | null
  /**
   * How full the active conversation's window is, from the last result.
   *
   * Null until a turn completes: it is derived from a result message, so a
   * resumed conversation reports nothing until it is spoken to again.
   */
  contextUsage: ContextUsage | null
  /**
   * Model, effort and permission mode changed from inside the conversation.
   *
   * Sticky for the life of the session and dropped when it ends, at which
   * point the agent's config takes over again. Empty means "exactly what the
   * config says".
   */
  overrides: SessionOverrides
  /** Epoch ms of the last activity, for idle teardown. */
  lastActiveAt: number
}

/**
 * One transcript entry. `message` is the SDK's own message object, passed
 * through untouched so the renderer can show exactly what Claude Code would.
 */
export type TranscriptEntry = {
  agentId: string
  /** Monotonic per agent; the renderer uses it for keys and ordering. */
  seq: number
  receivedAt: number
  message: unknown
}

/**
 * A tool the agent wants to use that needs the user's say-so.
 *
 * The SDK's bridge renders the prompt text itself (`title`, `displayName`,
 * `description`); the docs are explicit that these should be preferred over
 * reconstructing a sentence from the tool name and input, so they are carried
 * through verbatim.
 */
export type PermissionRequest = {
  id: string
  agentId: string
  toolName: string
  input: Record<string, unknown>
  title?: string
  displayName?: string
  description?: string
  decisionReason?: string
  blockedPath?: string
  /** True when the SDK offered rules that would stop it asking again. */
  canRemember: boolean
}

export type PermissionDecision = 'allow' | 'allow-always' | 'deny'

export function emptyRuntime(agentId: string): AgentRuntime {
  return {
    agentId,
    state: 'idle',
    sessionId: null,
    activeConversationId: null,
    error: null,
    usage: { ...EMPTY_USAGE },
    rateLimit: null,
    contextUsage: null,
    overrides: {},
    lastActiveAt: Date.now()
  }
}
