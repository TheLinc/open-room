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
import { userContent, type ImageAttachment, type UserContentBlock } from '@shared/attachments'
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
import { resumeTarget } from '@shared/conversation'
import { latestActive } from '@shared/archive'
import { turnOutcome } from '@shared/turn-outcome'
import { awaitingAfterTurn } from '@shared/awaiting'
import {
  INTERRUPT_GRACE_MS,
  pumpFailureIsFault,
  settledWithin,
  stopNeedsInterrupt
} from '@shared/stop-plan'
import { sessionScoped } from '@shared/permission-scope'
import { acknowledgement, openingCandidate, openingLine } from './voice-ack'
import {
  drain,
  queueActionForResult,
  shouldQueue,
  summarise,
  without,
  type QueueAction,
  type QueuedPrompt
} from '@shared/prompt-queue'
import { mcpHealthUpdate, withMcpDetail } from '@shared/mcp-health'
import { agentQueryOptions } from './agent-options'
import { bundledClaudePath } from './claude-binary'
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
import type { Placement, WorktreeManager } from './worktrees'
import type { WorktreeRecord } from '@shared/worktrees'
import { wslPlacement, type WslRuntime } from './wsl'
import { wslLoginHint } from '@shared/wsl'

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
  /**
   * Set by stop() before it closes the queue. The SDK re-raises an
   * interrupted turn's error result when the stream then ends, and that is
   * not a fault to show on an agent the user just stopped.
   */
  stopping: boolean
  /** Resolved when the current turn ends, by a result or by the stream closing. */
  turnWaiters: Array<() => void>
  /** The running turn's prompt arrived by voice; see `voice-ack.ts`. */
  voiceTurn: boolean
  /** The first assistant message of the turn has been considered for speech. */
  openingSpoken: boolean
  /** Reset each turn; caps how often an agent may speak and records whether it did. */
  turnSpeech: TurnSpeechState
  /** Where the picker's command list stands; see `commandListUpdate`. */
  commands: CommandListState
  /** Uuids of conversation messages already appended, to drop replays. */
  seen: Set<string>
  /** Prompts typed while this turn runs; sent one at a time as turns end. */
  queued: QueuedPrompt[]
  /**
   * Whether the auto-compact threshold has been asked for. Once per session:
   * the init message is re-sent every turn, and `getContextUsage()` is a
   * control round trip.
   */
  autoCompactFetched: boolean
  /**
   * A worktree created for this session that no conversation owns yet. The
   * session id that will own it arrives on the init message; if the session
   * dies before then, the worktree is removed rather than stranded.
   */
  pendingWorktree: WorktreeRecord | null
}

/** The slice of `WorktreeManager` the supervisor drives. */
export type WorktreePlacer = Pick<WorktreeManager, 'place' | 'commit' | 'abandon'>

/** The shape `query()` accepts on its input stream. */
type SDKUserInput = {
  type: 'user'
  message: { role: 'user'; content: string | UserContentBlock[] }
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
  /** What was asked, as broadcast; the HUD renders it while the turn waits. */
  request: PermissionRequest
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
  /**
   * Agents whose conversation has been chosen explicitly this session —
   * selected, or deliberately started new. Without this an explicit "new
   * conversation" is indistinguishable from "nothing chosen yet", and the
   * next prompt would resume the very conversation the user just left.
   */
  private readonly chosen = new Set<string>()
  /** Null until attached; every session then runs in its workspace. */
  private worktrees: WorktreePlacer | null = null
  /** Null off Windows or when wsl.exe is missing; WSL agents then fail to start with a reason. */
  private wsl: WslRuntime | null = null
  /**
   * Distro per running or starting WSL agent, for the login hint on failure.
   * Derived from the config at the top of every `start()` and cleared at the
   * top of every `stop()`, so a reconfigured or preflight-failed agent never
   * carries a stale distro.
   */
  private readonly wslDistros = new Map<string, string>()

  constructor(
    private readonly events: SupervisorEvents,
    private readonly conversations: ConversationStore,
    private readonly speech: SpeechBus,
    private options: SupervisorOptions = { maxConcurrent: 3 }
  ) {}

  setOptions(options: SupervisorOptions): void {
    this.options = options
  }

  /** Gives conversations their own git worktrees, for agents that ask. */
  setWorktrees(worktrees: WorktreePlacer | null): void {
    this.worktrees = worktrees
  }

  setWsl(wsl: WslRuntime | null): void {
    this.wsl = wsl
  }

  runtimeFor(agentId: string): AgentRuntime {
    return this.runtimes.get(agentId) ?? emptyRuntime(agentId)
  }

  allRuntimes(): AgentRuntime[] {
    return [...this.runtimes.values()]
  }

  /**
   * The permission prompts still waiting on a decision.
   *
   * An agent blocked on a prompt still reports `ready`, so its runtime state
   * cannot distinguish it from one with nothing to do. The HUD needs that
   * difference — with the main window closed, this is the only way a stalled
   * agent is visible at all — and it needs the request itself, so the prompt
   * can be answered from there without raising the window.
   */
  pendingRequests(): PermissionRequest[] {
    return [...this.pendingPermissions.values()].map((pending) => pending.request)
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
  async send(
    agent: Agent,
    text: string,
    images: ImageAttachment[] = [],
    options: { byVoice?: boolean } = {}
  ): Promise<{ ok: true; queued?: boolean } | { ok: false; message: string }> {
    const id = agent.config.id
    const existing = this.sessions.get(id)
    const byVoice = options.byVoice === true

    if (!existing) {
      const resumeId = await this.resolveResume(agent)
      const started = await this.start(agent, resumeId)
      if (!started.ok) return started
    }

    const session = this.sessions.get(id)
    if (!session) return { ok: false, message: 'Session did not start.' }

    // `start()` leaves the runtime at `starting` — the init message is what
    // moves it to `working` — so a cold agent's very first prompt must
    // dispatch unconditionally. Only a prompt sent into an already-running
    // session can be genuinely mid-turn.
    if (existing && shouldQueue(this.runtimeFor(id).state)) {
      session.queued = [...session.queued, { id: randomUUID(), text, images, byVoice }]
      this.patch(id, { queued: summarise(session.queued) })
      if (byVoice) this.say(agent, acknowledgement({ queued: true }))
      // Said explicitly so a voice prompt can show "queued" rather than a
      // tick: the pane that lists the queue is usually hidden when someone
      // is talking to an agent.
      return { ok: true, queued: true }
    }

    if (byVoice) this.say(agent, acknowledgement({ queued: false }))
    this.dispatch(session, text, images, byVoice)
    return { ok: true }
  }

  /**
   * The app's own voice: an acknowledgement, or the agent's opening line
   * echoed. Progress priority, so anything the agent asks preempts it and
   * the bus keeps only the newest. Silent for an agent with TTS off; the
   * sink would turn it into a notification, which nobody asked for.
   */
  private say(agent: Agent, text: string): void {
    if (!agent.config.tts.enabled) return
    this.speech.enqueue({
      id: randomUUID(),
      agentId: agent.config.id,
      agentName: agent.config.name,
      text,
      priority: 'progress',
      queuedAt: Date.now()
    })
  }

  /**
   * Lands an opened agent in its most recent conversation, so the pane shows
   * it before anything is typed. A no-op once a conversation has been chosen
   * or a session is live; the same resolution `send()` performs for a prompt.
   */
  async ensureConversation(agent: Agent): Promise<void> {
    if (this.sessions.has(agent.config.id)) return
    await this.resolveResume(agent)
  }

  /**
   * The conversation a cold agent's prompt continues. A prompt can arrive by
   * voice for an agent nobody has opened this session, so the latest
   * conversation is looked up here rather than left to the pane; the
   * runtime is patched so the pane, the switcher and the overlay all name
   * the conversation the prompt is about to land in.
   */
  private async resolveResume(agent: Agent): Promise<string | null> {
    const id = agent.config.id
    const activeId = this.runtimeFor(id).activeConversationId
    const chosen = this.chosen.has(id)

    // The latest *live* conversation: archiving one is the user saying "not
    // this", so the launch-time resume never lands in it.
    const latestId = chosen || activeId ? null : latestActive(await this.conversations.list(agent))
    const target = resumeTarget({ chosen, activeId, latestId })

    if (target !== activeId) this.patch(id, { activeConversationId: target, sessionId: target })
    return target
  }

  /** Pushes one prompt into the live session and echoes it to the transcript. */
  private dispatch(
    session: Session,
    text: string,
    images: ImageAttachment[],
    byVoice = false
  ): void {
    const id = session.agentId
    session.voiceTurn = byVoice
    session.openingSpoken = false
    // Any prompt to this agent answers whatever it was waiting on: the reply
    // is what clears "waiting for you", whichever route it arrived by.
    this.patch(id, {
      state: 'working',
      lastActiveAt: Date.now(),
      error: null,
      awaiting: null,
      // A new prompt supersedes the side question's card.
      aside: null
    })

    session.turnSpeech.calls = 0
    session.turnSpeech.spoke = false
    session.turnSpeech.asked = null

    const userMessage: SDKUserInput = {
      type: 'user',
      message: { role: 'user', content: userContent(text, images) },
      parent_tool_use_id: null
    }

    // The SDK does not echo input back on the output stream, so without this
    // the transcript shows the agent's replies with nothing to reply to.
    // Emitted in the SDK's own message shape so the renderer treats it
    // identically to everything else.
    session.seq += 1
    this.events.onTranscript({
      agentId: id,
      seq: session.seq,
      receivedAt: Date.now(),
      message: userMessage
    })

    session.queue.push(userMessage)
  }

  /** Removes one waiting prompt. A no-op, not a throw, if it is already gone. */
  dropQueued(agentId: string, promptId: string): void {
    const session = this.sessions.get(agentId)
    if (!session) {
      // No live session to hold a queue, but the ✕ should still clear
      // whatever the pane is showing rather than leaving a dead row.
      this.patch(agentId, { queued: [] })
      return
    }
    session.queued = without(session.queued, promptId)
    this.patch(agentId, { queued: summarise(session.queued) })
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

    const wslConfig = agent.config.wsl
    if (wslConfig) this.wslDistros.set(id, wslConfig.distro)
    else this.wslDistros.delete(id)
    if (wslConfig) {
      if (!this.wsl?.available) {
        const error = describeAgentError(
          'unknown',
          'WSL is not installed or wsl.exe is not on PATH.'
        )
        this.fail(id, error)
        return { ok: false, message: error.message }
      }
      const probe = await this.wsl.probeDir(wslConfig.distro, agent.config.workspacePath)
      if (probe.kind === 'missing') {
        const error = describeAgentError(
          'workspace-missing',
          `Workspace folder not found in ${wslConfig.distro}: ${agent.config.workspacePath}`
        )
        this.fail(id, error)
        return { ok: false, message: error.message }
      }
      if (probe.kind === 'unreachable') {
        const error = describeAgentError(
          'unknown',
          `Could not reach WSL distro ${wslConfig.distro}: ${probe.detail}`
        )
        this.fail(id, error)
        return { ok: false, message: error.message }
      }
    } else {
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
    }

    this.patch(id, { state: 'starting', error: null })

    // Where this session runs: the workspace, the distro's workspace for a
    // WSL agent, or the conversation's own git worktree. Decided before
    // `query()` because `cwd` is fixed at spawn, and reported on the runtime
    // so the pane never shows one checkout while the agent edits another.
    const placement: Placement = wslConfig
      ? wslPlacement(agent)
      : this.worktrees
        ? await this.worktrees.place(agent, resumeSessionId)
        : { cwd: agent.config.workspacePath, isolation: { kind: 'workspace' }, pending: null }
    this.patch(id, { isolation: placement.isolation })

    const queue = new PushableQueue<SDKUserInput>()

    const turnSpeech = newTurnSpeechState()

    try {
      // Options are built with the turn state in hand so the `speak` tool can
      // enforce its per-turn budget against the live session.
      const q = query({
        prompt: queue.stream(),
        options: this.optionsFor(agent, resumeSessionId, turnSpeech, placement.cwd)
      })
      const session: Session = {
        agentId: id,
        agent,
        queue,
        query: q,
        pump: Promise.resolve(),
        seq: 0,
        interrupting: false,
        stopping: false,
        turnWaiters: [],
        voiceTurn: false,
        openingSpoken: false,
        turnSpeech,
        commands: { loaded: false, terminal: [] },
        seen: new Set(),
        queued: [],
        autoCompactFetched: false,
        pendingWorktree: placement.pending
      }
      session.pump = this.pump(session)
      this.sessions.set(id, session)
      return { ok: true }
    } catch (error) {
      queue.close()
      // The session never existed, so nothing can own the worktree made for it.
      if (placement.pending) void this.worktrees?.abandon(agent, placement.pending)
      const classified = classifyThrownError(error)
      this.fail(id, classified)
      return { ok: false, message: classified.message }
    }
  }

  private optionsFor(
    agent: Agent,
    resumeSessionId: string | null,
    turnSpeech: TurnSpeechState,
    cwd: string
  ): Options {
    return agentQueryOptions(
      agent,
      resumeSessionId,
      // In-process, so the spoken line never leaves the app.
      createSpeakServer(agent, this.speech, turnSpeech),
      this.permissionHandler(agent.config.id),
      this.runtimeFor(agent.config.id).overrides,
      bundledClaudePath(),
      cwd,
      agent.config.wsl && this.wsl ? this.wsl.spawnClaude(agent.config.wsl.distro) : undefined
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

      const request: PermissionRequest = {
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
      }

      return new Promise<PermissionResult>((resolve) => {
        this.pendingPermissions.set(id, {
          agentId,
          request,
          resolve,
          suggestions: opts.suggestions
        })

        // The turn can be interrupted while the dialog is open; drop the
        // request rather than leaving a dead prompt on screen.
        opts.signal.addEventListener('abort', () => {
          if (this.pendingPermissions.delete(id)) {
            this.events.onPermissionResolved(id)
            resolve({ behavior: 'deny', message: 'Interrupted before a decision was made.' })
          }
        })

        this.events.onPermissionRequest(request)
      })
    }
  }

  /**
   * Chooses which conversation the next prompt continues. Nothing spawns —
   * selecting a conversation is a decision about resume, not a start.
   */
  setActiveConversation(agentId: string, sessionId: string | null): void {
    this.chosen.add(agentId)
    if (this.runtimeFor(agentId).activeConversationId === sessionId) return

    // Live entries belong to the conversation that produced them. Leaving
    // them mounted would show the previous conversation's messages under the
    // newly selected one; persisted history is reloaded from disk instead.
    this.events.onTranscriptCleared(agentId)
    // The checkout belongs to the conversation just left; the next start
    // reports its own.
    this.patch(agentId, {
      activeConversationId: sessionId,
      sessionId,
      error: null,
      isolation: null,
      cwd: null
    })
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
        ? { updatedPermissions: sessionScoped(pending.suggestions) }
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
      if (pumpFailureIsFault(session)) this.fail(id, classifyThrownError(error))
    } finally {
      // A turn can end here too — a crash or the stream simply closing — not
      // only through a `result` message, so this is a queue-settling point
      // as much as `settleQueue` itself: without clearing it here, a prompt
      // typed while the turn was running is left in `runtime.queued` forever
      // once the session is deleted below.
      session.queued = []
      this.patch(id, { queued: [] })
      session.queue.close()
      this.endTurn(session)
      this.sessions.delete(id)
      // A session that ended before its init message never got an id, so the
      // worktree made for it has no conversation to belong to.
      if (session.pendingWorktree) {
        void this.worktrees?.abandon(session.agent, session.pendingWorktree)
        session.pendingWorktree = null
      }
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
      message,
      // The row for an interrupted result would otherwise read as a crash.
      ...(message.type === 'result' && session.interrupting ? { interrupted: true } : {})
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
        // What the CLI is actually running, which can differ from what was
        // asked for; see permissionModeNotice. `cwd` likewise: read off the
        // CLI rather than assumed from the placement.
        this.patch(id, { permissionMode: message.permissionMode ?? null, cwd: message.cwd })

        // The session now has an id, so the worktree made for it has an owner.
        if (session.pendingWorktree) {
          const record = session.pendingWorktree
          session.pendingWorktree = null
          void this.worktrees?.commit(id, sessionId, record)
        }

        // Per-turn statuses are free; the error text behind a failure is a
        // control round trip, asked for only when a server is newly wrong.
        const health = mcpHealthUpdate(this.runtimeFor(id).mcpServers, message.mcp_servers)
        this.patch(id, { mcpServers: health.servers })
        if (health.fetchDetail) void this.loadMcpDetail(session)

        if (!session.autoCompactFetched) {
          session.autoCompactFetched = true
          void this.loadAutoCompact(session)
        }
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

    // The voice analogue of watching the reply begin: the turn's first
    // assistant message, spoken if it is plain enough to be spoken as is.
    if (message.type === 'assistant' && session.voiceTurn && !session.openingSpoken) {
      const candidate = openingCandidate(message)
      if (candidate.kind !== 'wait') {
        const turn = { byVoice: session.voiceTurn, openingSpoken: session.openingSpoken }
        session.openingSpoken = true
        const line = candidate.kind === 'text' ? openingLine(turn, candidate.text) : null
        if (line) this.say(session.agent, line)
      }
    }

    if (message.type === 'result') {
      const runtime = this.runtimeFor(id)

      // A slash command the CLI ran locally closes with a result of its own:
      // zero turns, zero usage. Reading those into the running totals would
      // wipe them, and its output is not something to read aloud.
      this.endTurn(session)
      if (isCommandResult(message)) {
        const wasInterrupted = session.interrupting
        session.interrupting = false
        this.patch(id, { state: 'ready', sessionId: message.session_id, lastActiveAt: Date.now() })
        this.settleQueue(
          session,
          queueActionForResult({ isCommandResult: true, isError: false, wasInterrupted })
        )
        return
      }

      const usage = message.subtype === 'success' ? message.usage : undefined
      // An interrupt the user asked for is not a fault, even though the SDK
      // reports it as an error result.
      const wasInterrupted = session.interrupting
      session.interrupting = false
      // `subtype` and `is_error` disagree for some failures (see
      // `turnOutcome`); everything below reads the one decision.
      const outcome = turnOutcome(message, wasInterrupted)

      this.patch(id, {
        // A result ends the turn; the session stays alive for the next one.
        state: outcome === 'error' ? 'error' : 'ready',
        sessionId: message.session_id,
        lastActiveAt: Date.now(),
        // A turn that spoke a question and then ended is an agent waiting on
        // the answer; the HUD shows it and push-to-talk aims at it.
        awaiting: awaitingAfterTurn(
          {
            asked: session.turnSpeech.asked,
            isError: message.is_error,
            wasInterrupted
          },
          Date.now()
        ),
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

      if (outcome === 'error') {
        // The structured event is the reliable signal. Falling back to
        // matching "rate limit" or "429" in prose worked only when the text
        // happened to say so, and said nothing about when to retry.
        this.settleQueue(
          session,
          queueActionForResult({ isCommandResult: false, isError: true, wasInterrupted })
        )
        // A flagged "success" carries its reason in `result` (an expired
        // OAuth session, a model the account cannot use); any other subtype
        // is its own reason.
        this.fail(
          id,
          this.classifyFailure(
            id,
            message.subtype === 'success' ? message.result : String(message.subtype)
          )
        )
        return
      }

      // The subtype test only narrows the type: `outcome` already implies it.
      if (outcome === 'success' && message.subtype === 'success') {
        void this.speakFallback(session, message.result)
      }

      this.settleQueue(
        session,
        queueActionForResult({ isCommandResult: false, isError: message.is_error, wasInterrupted })
      )
    }
  }

  /** Applies what a finished turn means for prompts typed while it ran. */
  private settleQueue(session: Session, action: QueueAction): void {
    const id = session.agentId
    if (action === 'clear') {
      session.queued = []
      this.patch(id, { queued: [] })
      return
    }

    // One prompt per result: each queued message was typed as its own
    // turn, so sending everything at once would change what was asked.
    const { next, rest } = drain(session.queued)
    session.queued = rest
    this.patch(id, { queued: summarise(rest) })
    if (next) this.dispatch(session, next.text, next.images, next.byVoice === true)
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

  /**
   * Reads where this session auto-compacts, so the context meter's warning
   * bands can anchor to the point compaction will actually happen rather
   * than to a round number. `autoCompactThreshold` is absolute tokens
   * (measured: 167000 against a 200000 window). Failure leaves the runtime
   * field as it was, and the meter falls back to the legacy fractions.
   */
  private async loadAutoCompact(session: Session): Promise<void> {
    try {
      const usage = await session.query.getContextUsage()
      this.patch(session.agentId, {
        autoCompact: {
          enabled: usage.isAutoCompactEnabled,
          thresholdTokens: usage.autoCompactThreshold ?? null
        }
      })
    } catch (error) {
      console.warn(`[supervisor] could not read auto-compact for ${session.agentId}:`, error)
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

  /**
   * Ends the turn and keeps the session: the pane's Stop button.
   *
   * The acknowledgement is not the end of the turn, so this waits for the
   * result, bounded, and closes the process if it never comes. A user who
   * pressed Stop wants the agent stopped, not a choice about process
   * lifetimes; the escalation is the app's to make.
   */
  async interrupt(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId)
    if (!session) return

    // Stop means stop everything: a queued prompt is a promise to send it
    // once the turn ends, and an interrupted turn never will. Routed through
    // settleQueue so there is one owner of clearing the queue.
    this.settleQueue(session, 'clear')

    const ended = this.turnEnded(session)
    session.interrupting = true
    try {
      await session.query.interrupt()
    } catch {
      // An interrupt racing the end of a turn is not an error worth surfacing.
      session.interrupting = false
      return
    }

    if ((await settledWithin(ended, INTERRUPT_GRACE_MS)) === 'timeout') {
      await this.stop(agentId)
      return
    }
    this.patch(agentId, { error: null })
  }

  /** Records a side question and, later, its answer, for the pane's card. */
  noteAside(agentId: string, aside: { question: string; answer: string | null }): void {
    const current = this.runtimeFor(agentId).aside
    const at = current && current.question === aside.question ? current.at : Date.now()
    this.patch(agentId, { aside: { ...aside, at } })
  }

  dismissAside(agentId: string): void {
    if (this.runtimeFor(agentId).aside) this.patch(agentId, { aside: null })
  }

  /** A promise for the end of the current turn, however it ends. */
  private turnEnded(session: Session): Promise<void> {
    return new Promise((resolve) => session.turnWaiters.push(resolve))
  }

  private endTurn(session: Session): void {
    const waiters = session.turnWaiters
    session.turnWaiters = []
    for (const resolve of waiters) resolve()
  }

  /** Ends the session and tears down the subprocess. */
  async stop(agentId: string): Promise<void> {
    this.wslDistros.delete(agentId)
    const session = this.sessions.get(agentId)
    if (!session) {
      this.patch(agentId, { state: 'idle' })
      return
    }

    // Any dialog still open belongs to a session that is going away; denying
    // unblocks the turn so the pump can finish instead of hanging on stop().
    this.rejectPendingFor(agentId)

    session.queued = []
    this.patch(agentId, { queued: [] })

    // Closing the queue alone lets the CLI finish the turn it is on before it
    // exits, so a Stop mid-turn used to wait for the whole reply. Interrupt
    // first; the result it produces is read as deliberate, not as a fault.
    session.stopping = true
    if (stopNeedsInterrupt(this.runtimeFor(agentId).state)) {
      session.interrupting = true
      try {
        await session.query.interrupt()
      } catch {
        // The turn ended on its own while the interrupt was in flight.
        session.interrupting = false
      }
    }

    session.queue.close()
    // A closed input lets the CLI exit on its own; one that will not exit
    // within the grace is closed by force, which the SDK escalates from
    // SIGTERM to SIGKILL. Teardown failures are already reflected in the
    // runtime state, so the pump's rejection is not re-raised here.
    if ((await settledWithin(session.pump, INTERRUPT_GRACE_MS)) === 'timeout') {
      session.query.close()
      await settledWithin(session.pump, INTERRUPT_GRACE_MS)
    }
    this.sessions.delete(agentId)
    // Overrides belong to the session that carried them. Keeping them would
    // mean an agent quietly starting its next conversation in plan mode
    // because of something set days ago. `queued` is repeated here too: a
    // prompt sent during the await above would have re-queued after the
    // clear further up, and this is the patch that has the last word.
    this.patch(agentId, { state: 'idle', overrides: {}, queued: [], awaiting: null })
  }

  /**
   * Ends the session and drops every trace of the agent: for deletion.
   *
   * Measured before this existed: deleting a working agent removed its
   * directory in 2 ms and left its CLI subprocess running a turn, with a
   * runtime still listed as `working` for an agent nothing could open.
   */
  async forget(agentId: string): Promise<void> {
    await this.stop(agentId)
    this.runtimes.delete(agentId)
    this.chosen.delete(agentId)
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
    const distro = this.wslDistros.get(agentId)
    const hinted =
      distro && error?.kind === 'not-authenticated'
        ? { ...error, hint: wslLoginHint(distro) }
        : error
    this.patch(agentId, { state: 'error', error: hinted })
  }

  private patch(agentId: string, changes: Partial<AgentRuntime>): void {
    const next: AgentRuntime = { ...this.runtimeFor(agentId), ...changes, agentId }
    this.runtimes.set(agentId, next)
    this.events.onRuntime(next)
  }
}
