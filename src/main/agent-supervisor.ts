import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import {
  query,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { Agent } from '@shared/agent'
import {
  emptyRuntime,
  type AgentRuntime,
  type PermissionDecision,
  type PermissionRequest,
  type RateLimitStatus,
  type TranscriptEntry
} from '@shared/agent-runtime'
import { classifyThrownError, describeAgentError, kindFromAssistantError } from './agent-errors'
import { describeQuota } from '@shared/quota'
import { contextUsageFrom } from '@shared/context-usage'
import {
  commandListUpdate,
  isCommandResult,
  visibleCommands,
  type CommandListState
} from '@shared/slash-commands'
import { replayKey } from '@shared/compaction'
import { mcpHealthUpdate, withMcpDetail } from '@shared/mcp-health'
import { agentQueryOptions } from './agent-options'
import {
  effectiveSettings,
  mergeOverrides,
  overrideControlCalls,
  type SessionOverridePatch
} from '@shared/session-overrides'
import { PushableQueue } from './message-queue'
import type { ConversationStore } from './conversation-store'
import type { SpeechBus } from './speech-bus'
import {
  createSpeakServer,
  newTurnSpeechState,
  SPEAK_TOOL_NAME,
  type TurnSpeechState
} from './speak-tool'
import { condenseForSpeech, shouldSpeakFallback, speakableAsIs } from './condense'

/**
 * Owns the lifecycle of every running agent.
 *
 * Each active agent is one long-lived `query()` call in **streaming input
 * mode** — a single session driven by an async generator that user messages
 * are pushed into. This is not interchangeable with calling `query()` per
 * turn: single-message mode supports neither `interrupt()` nor in-loop
 * permission prompts, both of which Open Room requires.
 */

type Session = {
  agentId: string
  /** Kept so session-scoped work (tagging, resume) has the config to hand. */
  agent: Agent
  queue: PushableQueue<SDKUserInput>
  query: Query
  /** Resolves when the message pump finishes, so stop() can await teardown. */
  pump: Promise<void>
  seq: number
  /**
   * Set while an interrupt the user asked for is in flight. The SDK reports an
   * interrupted turn as an error result (`error_during_execution`), which is
   * indistinguishable from a genuine failure without this flag — and showing
   * "needs attention" because someone pressed Stop is wrong.
   */
  interrupting: boolean
  /** Reset each turn; caps how often an agent may speak and records whether it did. */
  turnSpeech: TurnSpeechState
  /** Where the picker's command list stands; see `commandListUpdate`. */
  commands: CommandListState
  /** Uuids of conversation messages already appended, to drop replays. */
  seen: Set<string>
}

/** The shape `query()` accepts on its input stream. */
type SDKUserInput = {
  type: 'user'
  message: { role: 'user'; content: string }
  parent_tool_use_id: null
}

export type SupervisorEvents = {
  onRuntime: (runtime: AgentRuntime) => void
  onTranscript: (entry: TranscriptEntry) => void
  onPermissionRequest: (request: PermissionRequest) => void
  /** Fired when a request is answered or withdrawn, so the UI can dismiss it. */
  onPermissionResolved: (requestId: string) => void
  /**
   * Fired when an agent's streamed transcript no longer belongs to what the
   * pane is showing — switching conversations, or starting a new one.
   */
  onTranscriptCleared: (agentId: string) => void
  /**
   * Subscription quota, reported per agent but true of the whole account.
   *
   * Raised out of the runtime so main can hold one account-level value: every
   * agent draws on the same login, and only the agent whose turn carried the
   * event would otherwise know.
   */
  onQuota: (limit: RateLimitStatus) => void
}

type PendingPermission = {
  agentId: string
  resolve: (result: PermissionResult) => void
  /** Rules the SDK offered that would stop it asking again this session. */
  suggestions?: PermissionUpdate[]
}

export type SupervisorOptions = {
  /** Cap on simultaneously running agents. Each is a full CLI subprocess. */
  maxConcurrent: number
}

export class AgentSupervisor {
  private readonly sessions = new Map<string, Session>()
  private readonly runtimes = new Map<string, AgentRuntime>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()

  constructor(
    private readonly events: SupervisorEvents,
    private readonly conversations: ConversationStore,
    private readonly speech: SpeechBus,
    private options: SupervisorOptions = { maxConcurrent: 3 }
  ) {}

  setOptions(options: SupervisorOptions): void {
    this.options = options
  }

  runtimeFor(agentId: string): AgentRuntime {
    return this.runtimes.get(agentId) ?? emptyRuntime(agentId)
  }

  allRuntimes(): AgentRuntime[] {
    return [...this.runtimes.values()]
  }

  /**
   * Agents waiting on a permission decision.
   *
   * An agent blocked on a prompt still reports `ready`, so its runtime state
   * cannot distinguish it from one with nothing to do. The HUD needs that
   * difference — with the main window closed, this is the only way a stalled
   * agent is visible at all.
   */
  blockedAgentIds(): Set<string> {
    const ids = new Set<string>()
    for (const pending of this.pendingPermissions.values()) ids.add(pending.agentId)
    return ids
  }

  get runningCount(): number {
    return this.sessions.size
  }

  /**
   * Sends a prompt, starting a session first if the agent has none.
   *
   * Returns an error message on failure rather than throwing — the caller is
   * an IPC handler, and a rejected `invoke` reaches the renderer as an opaque
   * string with a main-process stack attached.
   */
  async send(agent: Agent, text: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const existing = this.sessions.get(agent.config.id)

    if (!existing) {
      const resumeId = this.runtimeFor(agent.config.id).activeConversationId
      const started = await this.start(agent, resumeId)
      if (!started.ok) return started
    }

    const session = this.sessions.get(agent.config.id)
    if (!session) return { ok: false, message: 'Session did not start.' }

    this.patch(agent.config.id, { state: 'working', lastActiveAt: Date.now(), error: null })

    session.turnSpeech.calls = 0
    session.turnSpeech.spoke = false

    const userMessage: SDKUserInput = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null
    }

    // The SDK does not echo input back on the output stream, so without this
    // the transcript shows the agent's replies with nothing to reply to.
    // Emitted in the SDK's own message shape so the renderer treats it
    // identically to everything else.
    session.seq += 1
    this.events.onTranscript({
      agentId: agent.config.id,
      seq: session.seq,
      receivedAt: Date.now(),
      message: userMessage
    })

    session.queue.push(userMessage)
    return { ok: true }
  }

  private async start(
    agent: Agent,
    resumeSessionId: string | null
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const id = agent.config.id

    if (this.sessions.size >= this.options.maxConcurrent) {
      const message = `At the ${this.options.maxConcurrent}-agent limit. Stop another agent first.`
      this.fail(id, describeAgentError('unknown', message))
      return { ok: false, message }
    }

    // Checked before spawning: the CLI's own failure for a missing directory
    // is far less clear than saying so directly.
    try {
      const info = await stat(agent.config.workspacePath)
      if (!info.isDirectory()) throw new Error('not a directory')
    } catch {
      const error = describeAgentError(
        'workspace-missing',
        `Workspace folder not found: ${agent.config.workspacePath}`
      )
      this.fail(id, error)
      return { ok: false, message: error.message }
    }

    this.patch(id, { state: 'starting', error: null })

    const queue = new PushableQueue<SDKUserInput>()

    const turnSpeech = newTurnSpeechState()

    try {
      // Options are built with the turn state in hand so the `speak` tool can
      // enforce its per-turn budget against the live session.
      const q = query({
        prompt: queue.stream(),
        options: this.optionsFor(agent, resumeSessionId, turnSpeech)
      })
      const session: Session = {
        agentId: id,
        agent,
        queue,
        query: q,
        pump: Promise.resolve(),
        seq: 0,
        interrupting: false,
        turnSpeech,
        commands: { loaded: false, terminal: [] },
        seen: new Set()
      }
      session.pump = this.pump(session)
      this.sessions.set(id, session)
      return { ok: true }
    } catch (error) {
      queue.close()
      const classified = classifyThrownError(error)
      this.fail(id, classified)
      return { ok: false, message: classified.message }
    }
  }

  private optionsFor(
    agent: Agent,
    resumeSessionId: string | null,
    turnSpeech: TurnSpeechState
  ): Options {
    return agentQueryOptions(
      agent,
      resumeSessionId,
      // In-process, so the spoken line never leaves the app.
      createSpeakServer(agent, this.speech, turnSpeech),
      this.permissionHandler(agent.config.id),
      this.runtimeFor(agent.config.id).overrides
    )
  }

  /**
   * Asks the user about a tool the permission flow did not already settle.
   *
   * This only fires in streaming input mode — another reason the supervisor
   * cannot be built on one-shot `query()` calls. The promise is held open
   * until the renderer answers, which is exactly the in-loop behaviour
   * wanted: the turn pauses rather than ending.
   */
  private permissionHandler(agentId: string) {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      opts: {
        signal: AbortSignal
        suggestions?: PermissionUpdate[]
        title?: string
        displayName?: string
        description?: string
        decisionReason?: string
        blockedPath?: string
      }
    ): Promise<PermissionResult> => {
      // Defence in depth: allowedTools should already cover this, but a
      // permission prompt for speech would hang the turn, so never ask.
      if (toolName === SPEAK_TOOL_NAME) {
        return { behavior: 'allow' as const }
      }

      const id = randomUUID()

      return new Promise<PermissionResult>((resolve) => {
        this.pendingPermissions.set(id, { agentId, resolve, suggestions: opts.suggestions })

        // The turn can be interrupted while the dialog is open; drop the
        // request rather than leaving a dead prompt on screen.
        opts.signal.addEventListener('abort', () => {
          if (this.pendingPermissions.delete(id)) {
            this.events.onPermissionResolved(id)
            resolve({ behavior: 'deny', message: 'Interrupted before a decision was made.' })
          }
        })

        this.events.onPermissionRequest({
          id,
          agentId,
          toolName,
          input,
          title: opts.title,
          displayName: opts.displayName,
          description: opts.description,
          decisionReason: opts.decisionReason,
          blockedPath: opts.blockedPath,
          canRemember: (opts.suggestions?.length ?? 0) > 0
        })
      })
    }
  }

  /**
   * Chooses which conversation the next prompt continues. Nothing spawns —
   * selecting a conversation is a decision about resume, not a start.
   */
  setActiveConversation(agentId: string, sessionId: string | null): void {
    if (this.runtimeFor(agentId).activeConversationId === sessionId) return

    // Live entries belong to the conversation that produced them. Leaving
    // them mounted would show the previous conversation's messages under the
    // newly selected one; persisted history is reloaded from disk instead.
    this.events.onTranscriptCleared(agentId)
    this.patch(agentId, { activeConversationId: sessionId, sessionId, error: null })
  }

  respondToPermission(requestId: string, decision: PermissionDecision): void {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return

    this.pendingPermissions.delete(requestId)
    this.events.onPermissionResolved(requestId)

    if (decision === 'deny') {
      pending.resolve({ behavior: 'deny', message: 'You declined this action.' })
      return
    }

    pending.resolve({
      behavior: 'allow',
      // Returning the full suggestion set is what stops the SDK asking again
      // for this tool during the session.
      ...(decision === 'allow-always' && pending.suggestions
        ? { updatedPermissions: pending.suggestions }
        : {})
    })
  }

  /** Drains the session's message stream until it ends or throws. */
  private async pump(session: Session): Promise<void> {
    const id = session.agentId

    try {
      for await (const message of session.query) {
        this.handleMessage(session, message)
      }
      // The stream ending means the session is over — normally because
      // stop() closed the queue.
      this.patch(id, { state: 'idle' })
    } catch (error) {
      this.fail(id, classifyThrownError(error))
    } finally {
      session.queue.close()
      this.sessions.delete(id)
    }
  }

  private handleMessage(session: Session, message: SDKMessage): void {
    const id = session.agentId

    // Compaction re-emits the messages it preserved, under their original
    // uuids; the transcript would show them twice. Measured on a manual
    // `/compact`: the previous command's output arrived again, timestamped
    // before the boundary it followed.
    const key = replayKey(message)
    if (key) {
      if (session.seen.has(key)) return
      session.seen.add(key)
    }

    session.seq += 1
    this.events.onTranscript({
      agentId: id,
      seq: session.seq,
      receivedAt: Date.now(),
      message
    })

    if (message.type === 'system' && 'session_id' in message) {
      const sessionId = message.session_id
      this.patch(id, { sessionId, activeConversationId: sessionId, state: 'working' })

      // The decision about the picker's list is pure and tested; this only
      // carries it out.
      const update = commandListUpdate(session.commands, message)
      session.commands = update.state
      if (update.action?.kind === 'fetch') void this.loadCommands(session)
      if (update.action?.kind === 'replace') this.patch(id, { commands: update.action.commands })

      if (message.subtype === 'init') {
        // Per-turn statuses are free; the error text behind a failure is a
        // control round trip, asked for only when a server is newly wrong.
        const health = mcpHealthUpdate(this.runtimeFor(id).mcpServers, message.mcp_servers)
        this.patch(id, { mcpServers: health.servers })
        if (health.fetchDetail) void this.loadMcpDetail(session)
      }

      // Tag the session so it can be found again as this agent's. Resumed
      // sessions are already tagged; re-tagging is harmless and keeps a
      // freshly created one from being orphaned.
      const agent = session.agent
      void this.conversations.claim(agent, sessionId)
      return
    }

    // Subscription quota, reported out-of-band from the turn. Surfaced on the
    // runtime so the UI can explain a stall instead of leaving it a mystery.
    if (message.type === 'rate_limit_event') {
      const info = message.rate_limit_info as RateLimitStatus & {
        overageStatus?: string
        overageDisabledReason?: string
      }
      const limit: RateLimitStatus = {
        status: info.status,
        resetsAt: info.resetsAt,
        rateLimitType: info.rateLimitType,
        utilization: info.utilization,
        isUsingOverage: info.isUsingOverage,
        overageStatus: info.overageStatus,
        overageDisabledReason: info.overageDisabledReason
      }

      this.patch(id, { rateLimit: limit })
      this.events.onQuota(limit)
      return
    }

    if (message.type === 'assistant' && message.error) {
      const kind = kindFromAssistantError(message.error)
      this.fail(id, describeAgentError(kind, `The model returned: ${message.error}`))
      return
    }

    if (message.type === 'result') {
      const runtime = this.runtimeFor(id)

      // A slash command the CLI ran locally closes with a result of its own:
      // zero turns, zero usage. Reading those into the running totals would
      // wipe them, and its output is not something to read aloud.
      if (isCommandResult(message)) {
        session.interrupting = false
        this.patch(id, { state: 'ready', sessionId: message.session_id, lastActiveAt: Date.now() })
        return
      }

      const usage = message.subtype === 'success' ? message.usage : undefined
      // An interrupt the user asked for is not a fault, even though the SDK
      // reports it as an error result.
      const wasInterrupted = session.interrupting
      session.interrupting = false

      this.patch(id, {
        // A result ends the turn; the session stays alive for the next one.
        state: message.is_error && !wasInterrupted ? 'error' : 'ready',
        sessionId: message.session_id,
        lastActiveAt: Date.now(),
        usage: {
          // Cumulative across turns in streaming-input sessions, so each
          // result carries the running total — read it, do not accumulate.
          totalCostUsd: message.total_cost_usd ?? runtime.usage.totalCostUsd,
          inputTokens: usage?.input_tokens ?? runtime.usage.inputTokens,
          outputTokens: usage?.output_tokens ?? runtime.usage.outputTokens,
          cacheReadTokens: usage?.cache_read_input_tokens ?? runtime.usage.cacheReadTokens,
          numTurns: message.num_turns ?? runtime.usage.numTurns
        },
        // Derived here rather than in the renderer so the pane has nothing to
        // recompute, and so the "which usage field" question is answered in
        // one place. `usage` is per-request; `modelUsage` is cumulative.
        contextUsage:
          contextUsageFrom(
            message.usage as Parameters<typeof contextUsageFrom>[0],
            message.modelUsage as Parameters<typeof contextUsageFrom>[1],
            session.agent.config.model
          ) ?? runtime.contextUsage
      })

      if (message.is_error && message.subtype !== 'success' && !wasInterrupted) {
        // The structured event is the reliable signal. Falling back to
        // matching "rate limit" or "429" in prose worked only when the text
        // happened to say so, and said nothing about when to retry.
        this.fail(id, this.classifyFailure(id, String(message.subtype)))
        return
      }

      if (message.subtype === 'success' && !wasInterrupted) {
        void this.speakFallback(session, message.result)
      }
    }
  }

  /**
   * Fetches the command list for the picker once a session has initialised.
   *
   * Failure leaves the list empty, which the renderer treats as "unknown"
   * rather than "none": a draft still sends, and the CLI judges it.
   */
  private async loadCommands(session: Session): Promise<void> {
    try {
      const all = await session.query.supportedCommands()
      this.patch(session.agentId, { commands: visibleCommands(all, session.commands.terminal) })
    } catch (error) {
      console.warn(`[supervisor] could not list commands for ${session.agentId}:`, error)
    }
  }

  /** Adds error text, scope and tool counts to the servers already listed. */
  private async loadMcpDetail(session: Session): Promise<void> {
    try {
      const detail = await session.query.mcpServerStatus()
      const current = this.runtimeFor(session.agentId).mcpServers
      this.patch(session.agentId, { mcpServers: withMcpDetail(current, detail) })
    } catch (error) {
      console.warn(`[supervisor] could not read MCP status for ${session.agentId}:`, error)
    }
  }

  /**
   * Says something when a turn finished but the agent never called `speak`.
   *
   * Every reply an agent leaves silent gets spoken for it, so finishing is
   * always audible. An agent that called `speak` itself is left alone — its
   * own line is better than a condensed one and arrives sooner.
   */
  private async speakFallback(session: Session, finalText: string): Promise<void> {
    const { config } = session.agent
    const name = config.name

    const speak = shouldSpeakFallback({
      ttsEnabled: config.tts.enabled,
      alreadySpoke: session.turnSpeech.spoke,
      // The caller reaches here only for a successful, uninterrupted turn;
      // both are restated so the rule reads completely in one place.
      succeeded: true,
      interrupted: false
    })
    if (!speak) return

    // Asking the model costs 8-9s and cannot be made faster, so a reply that
    // is already short and plain is spoken as written instead.
    const sentence = speakableAsIs(finalText) ?? (await condenseForSpeech(finalText))
    if (!sentence) return

    this.speech.enqueue({
      id: randomUUID(),
      agentId: config.id,
      agentName: name,
      text: sentence,
      priority: 'done',
      queuedAt: Date.now()
    })
  }

  /**
   * Changes model, effort or permission mode for the running session.
   *
   * Applied to a live session through the SDK's control methods, which exist
   * only in streaming input mode. With no session yet it is still recorded,
   * so the next one starts with it — otherwise setting "plan first" and then
   * typing would plan on the *second* turn, which is the one case the control
   * exists for.
   */
  async setOverrides(agentId: string, patch: SessionOverridePatch): Promise<void> {
    const runtime = this.runtimeFor(agentId)
    const previous = runtime.overrides
    const next = mergeOverrides(previous, patch)

    this.patch(agentId, { overrides: next })

    const session = this.sessions.get(agentId)
    if (!session) return

    const config = session.agent.config
    const calls = overrideControlCalls(
      effectiveSettings(config, previous),
      effectiveSettings(config, next)
    )

    for (const call of calls) {
      if (call.kind === 'model') await session.query.setModel(call.model)
      else if (call.kind === 'permissionMode') await session.query.setPermissionMode(call.mode)
      else await session.query.applyFlagSettings({ effortLevel: call.effortLevel })
    }
  }

  async interrupt(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId)
    if (!session) return

    session.interrupting = true
    try {
      await session.query.interrupt()
      this.patch(agentId, { state: 'ready', error: null })
    } catch {
      // An interrupt racing the end of a turn is not an error worth surfacing.
      session.interrupting = false
    }
  }

  /** Ends the session and tears down the subprocess. */
  async stop(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId)
    if (!session) {
      this.patch(agentId, { state: 'idle' })
      return
    }

    // Any dialog still open belongs to a session that is going away; denying
    // unblocks the turn so the pump can finish instead of hanging on stop().
    this.rejectPendingFor(agentId)

    session.queue.close()
    try {
      await session.pump
    } catch {
      // Teardown failures are already reflected in the runtime state.
    }
    this.sessions.delete(agentId)
    // Overrides belong to the session that carried them. Keeping them would
    // mean an agent quietly starting its next conversation in plan mode
    // because of something set days ago.
    this.patch(agentId, { state: 'idle', overrides: {} })
  }

  private rejectPendingFor(agentId: string): void {
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.agentId !== agentId) continue
      this.pendingPermissions.delete(id)
      this.events.onPermissionResolved(id)
      pending.resolve({ behavior: 'deny', message: 'The session was stopped.' })
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)))
  }

  /** Ends sessions idle longer than `maxIdleMs`. Each holds a CLI subprocess. */
  async reapIdle(maxIdleMs: number): Promise<string[]> {
    const now = Date.now()
    const stale = [...this.sessions.keys()].filter((id) => {
      const runtime = this.runtimeFor(id)
      return runtime.state === 'ready' && now - runtime.lastActiveAt > maxIdleMs
    })

    await Promise.all(stale.map((id) => this.stop(id)))
    return stale
  }

  /**
   * Why a turn failed, preferring the quota event over the error text.
   *
   * `rate_limit_event` arrives out of band and carries both the reason and
   * the reset time, so an agent stopped by quota can say when it is worth
   * trying again instead of guessing from a string.
   */
  private classifyFailure(agentId: string, subtype: string): AgentRuntime['error'] {
    const limit = this.runtimeFor(agentId).rateLimit
    if (limit?.status === 'rejected') {
      const error = describeAgentError('rate-limited', describeQuota(limit) ?? subtype)
      return limit.resetsAt ? { ...error, retryAt: limit.resetsAt * 1000 } : error
    }
    return classifyThrownError(new Error(subtype))
  }

  private fail(agentId: string, error: AgentRuntime['error']): void {
    this.patch(agentId, { state: 'error', error })
  }

  private patch(agentId: string, changes: Partial<AgentRuntime>): void {
    const next: AgentRuntime = { ...this.runtimeFor(agentId), ...changes, agentId }
    this.runtimes.set(agentId, next)
    this.events.onRuntime(next)
  }
}
