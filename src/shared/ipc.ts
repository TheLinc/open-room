import type { Agent } from './agent'
import type { ImageAttachment } from './attachments'
import type {
  AgentRuntime,
  RateLimitStatus,
  PermissionDecision,
  PermissionRequest,
  TranscriptEntry
} from './agent-runtime'
import type { Conversation, ConversationPage } from './conversation'
import type { SessionOverridePatch } from './session-overrides'
import type { LoginStatus } from './login'
import type { HotkeyFailure } from './hotkeys'
import type { AppSettings } from './settings'
import type { MicrophoneDevice } from './voice-input'
import type { KokoroStatus, SttStatus, SystemVoice } from './voice-rpc'
import type { WslConfig, WslDistro } from './wsl'

/**
 * The IPC contract between main, preload, and renderer.
 *
 * This module is imported by all three processes, so it must stay free of
 * Electron and Node imports — types and constants only.
 *
 * Main owns all authoritative state; the renderer is display and input only.
 * Every renderer→main call goes through a channel declared here.
 */

export type AppInfo = {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: 'win32' | 'darwin' | 'linux'
}

/** A directory under `~/.open-room/agents` that exists but failed to load. */
export type AgentLoadError = {
  id: string
  message: string
}

export type AgentsSnapshot = {
  agents: Agent[]
  errors: AgentLoadError[]
}

/**
 * Mutations report failure in the result rather than throwing across IPC —
 * an `invoke` rejection arrives in the renderer as an opaque string with the
 * main-process stack glued on, which is not something to show a user.
 */
export type MutationResult = { ok: true } | { ok: false; message: string }

export const IpcChannel = {
  getAppInfo: 'app:get-info',

  listAgents: 'agents:list',
  createAgent: 'agents:create',
  updateAgent: 'agents:update',
  deleteAgent: 'agents:delete',
  pickWorkspace: 'agents:pick-workspace',
  /** main → renderer, fired when the agents directory changes on disk. */
  agentsChanged: 'agents:changed',
  /** renderer → main, which agent the window has selected. */
  selectAgent: 'agents:select',

  sendPrompt: 'session:send',
  interruptAgent: 'session:interrupt',
  /** Removes one prompt waiting for the current turn to end. */
  dropQueuedPrompt: 'session:drop-queued',
  setOverrides: 'session:set-overrides',
  stopAgent: 'session:stop',
  listRuntimes: 'session:runtimes',
  /** main → renderer, per-agent lifecycle and usage updates. */
  runtimeChanged: 'session:runtime-changed',
  /** main → renderer, one SDK message appended to an agent's transcript. */
  transcriptAppended: 'session:transcript',
  /** main → renderer, drop this agent's streamed entries. */
  transcriptCleared: 'session:transcript-cleared',
  /** main → renderer, a tool is waiting on the user's decision. */
  permissionRequested: 'session:permission-requested',
  /** main → renderer, that request has been answered or withdrawn. */
  permissionResolved: 'session:permission-resolved',
  respondPermission: 'session:permission-respond',

  listConversations: 'conversation:list',
  loadConversation: 'conversation:load',
  selectConversation: 'conversation:select',
  newConversation: 'conversation:new',
  renameConversation: 'conversation:rename',
  deleteConversation: 'conversation:delete',
  clearConversations: 'conversation:clear-all',

  listVoices: 'voice:list',
  quotaChanged: 'quota:changed',
  getQuota: 'quota:get',
  loginChanged: 'login:changed',
  getLogin: 'login:get',
  recheckLogin: 'login:recheck',
  previewVoice: 'voice:preview',
  kokoroStatus: 'voice:kokoro-status',
  loadKokoro: 'voice:kokoro-load',

  sttStatus: 'voice:stt-status',
  loadSttModel: 'voice:stt-load',
  /** main → renderer, bindings that could not be registered. */
  hotkeyFailures: 'voice:hotkey-failures',
  getHotkeyFailures: 'voice:hotkey-failures-get',

  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  /** main → renderer, settings changed somewhere other than the dialog. */
  settingsChanged: 'settings:changed',

  /** main → overlay, the whole overlay state on every change. */
  overlayState: 'overlay:state',
  /** overlay → main, where its interactive region is and whether it takes clicks. */
  overlayHitBox: 'overlay:hit-box',
  /** main → overlay, whether the real cursor is inside that region. */
  overlayPointer: 'overlay:pointer',
  /** main → overlay, open the microphone. */
  overlayStartCapture: 'overlay:start-capture',
  /** main → overlay, flush the audio and send it back. */
  overlayStopCapture: 'overlay:stop-capture',
  /** main → overlay, close the microphone and throw the audio away. */
  overlayDiscardCapture: 'overlay:discard-capture',
  /** overlay → main, the finished capture as base64 PCM. */
  overlayAudio: 'overlay:audio',
  /** main → overlay, begin or end always-on wake listening. */
  overlayStartWake: 'overlay:start-wake',
  overlayStopWake: 'overlay:stop-wake',
  /** main → overlay, suppress segments while the app is speaking. */
  overlayMuteWake: 'overlay:mute-wake',
  /** overlay → main, one segment the gate accepted, as base64 PCM. */
  overlayWakeSegment: 'overlay:wake-segment',
  /** overlay → main, someone started talking over the app. */
  overlayBargeIn: 'overlay:barge-in',
  /** overlay → main, the input devices it can see. */
  overlayMicrophones: 'overlay:microphones',
  /** main → overlay, which device to listen on. Empty is the system default. */
  overlaySetMicrophone: 'overlay:set-microphone',
  /** main → overlay, open the microphone purely to report its level. */
  overlayStartMeter: 'overlay:start-meter',
  /** main → overlay, close the metering stream. */
  overlayStopMeter: 'overlay:stop-meter',
  /** overlay → main, one RMS reading from the metering stream. */
  overlayLevel: 'overlay:level',
  /** renderer → main, start or stop the microphone test in settings. */
  setMicrophoneTest: 'voice:set-microphone-test',
  /** main → renderer, a level to draw, or null once the test has stopped. */
  microphoneLevel: 'voice:microphone-level',
  /** renderer → main, the cached device list for the settings picker. */
  listMicrophones: 'voice:list-microphones',
  /** main → renderer, the list changed — a headset appeared or vanished. */
  microphonesChanged: 'voice:microphones-changed',
  /** overlay → main, what the endpointer observed. */
  overlayEvent: 'overlay:event',
  /** overlay → main, pointer entered or left the bubble; pauses dismissal. */
  overlayHover: 'overlay:hover',
  /** main → overlay, one pip per working or blocked agent. */
  overlayPips: 'overlay:pips',
  /** overlay → main, raise the main window on this agent. */
  overlaySelectAgent: 'overlay:select-agent',
  /** main → renderer, select this agent, from a clicked pip. */
  focusAgent: 'app:focus-agent',

  listWorkspaceFiles: 'agents:list-workspace-files',
  openInEditor: 'files:open-in-editor',
  /** A read-only unified diff of one file the agent changed. */
  fileDiff: 'files:diff',
  /** Whether a folder is a git repository, for the editor's worktree switch. */
  inspectWorkspace: 'agents:inspect-workspace',
  /** Installed WSL distros, for the editor's Run in WSL control. Empty off Windows. */
  listWslDistros: 'wsl:list-distros'
} as const

/**
 * The diff behind a "Files changed" row. `base` says what the file is being
 * compared with: `HEAD` in the workspace, or the commit a worktree
 * conversation branched from — so committed work in the worktree shows too.
 */
export type FileDiffResult =
  | {
      ok: true
      base: 'head' | 'branch-base'
      /** Raw `git diff` output, rendered by the pane's own parser. */
      diff: string
      binary: boolean
      /** Over the size cap; `diff` is empty and the pane says so. */
      tooLarge: boolean
      /** Nothing differs from the base (already reverted, or identical). */
      empty: boolean
    }
  | { ok: false; message: string }

export type WorkspaceInfo = {
  exists: boolean
  /** Inside a git working tree, so per-conversation worktrees can be offered. */
  git: boolean
}

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

/**
 * The surface exposed on `window.openRoom` by the preload script.
 * Keep this in sync with `src/preload/index.ts`.
 */
export type OpenRoomApi = {
  getAppInfo: () => Promise<AppInfo>

  listAgents: () => Promise<AgentsSnapshot>
  createAgent: (agent: Agent) => Promise<MutationResult>
  updateAgent: (agent: Agent) => Promise<MutationResult>
  deleteAgent: (id: string) => Promise<MutationResult>
  /** Opens a native directory picker. Resolves null if cancelled. */
  pickWorkspace: () => Promise<string | null>
  /** Subscribes to on-disk changes. Returns an unsubscribe function. */
  onAgentsChanged: (listener: () => void) => () => void
  /**
   * Tells main which agent is on screen, so the global push-to-talk hotkey
   * knows who it is addressing. Null when there is nothing to select.
   */
  selectAgent: (agentId: string | null) => void
  /** Fires when a pip in the overlay HUD is clicked. */
  onFocusAgent: (listener: (agentId: string) => void) => () => void

  /**
   * Starts the agent's session if needed, then queues the prompt.
   * Images ride along as content blocks; see `userContent`.
   */
  sendPrompt: (agentId: string, text: string, images?: ImageAttachment[]) => Promise<MutationResult>
  /** Stops the current turn, leaving the session alive. */
  interruptAgent: (agentId: string) => Promise<MutationResult>
  /** Removes one prompt waiting for the current turn to end. */
  dropQueuedPrompt: (agentId: string, id: string) => Promise<void>
  /**
   * Changes model, effort or permission mode for this session only.
   *
   * `null` clears a field back to the agent's config. Sticky until changed
   * or until the session ends.
   */
  setOverrides: (agentId: string, patch: SessionOverridePatch) => Promise<MutationResult>
  /** Ends the session and tears down the subprocess. */
  stopAgent: (agentId: string) => Promise<MutationResult>
  listRuntimes: () => Promise<AgentRuntime[]>
  onRuntimeChanged: (listener: (runtime: AgentRuntime) => void) => () => void
  onTranscriptAppended: (listener: (entry: TranscriptEntry) => void) => () => void
  onTranscriptCleared: (listener: (agentId: string) => void) => () => void

  onPermissionRequested: (listener: (request: PermissionRequest) => void) => () => void
  onPermissionResolved: (listener: (requestId: string) => void) => () => void
  respondPermission: (requestId: string, decision: PermissionDecision) => Promise<void>

  listConversations: (agentId: string) => Promise<Conversation[]>
  /** Omit `offset` for the most recent slice. */
  loadConversation: (
    agentId: string,
    sessionId: string,
    options: { limit: number; offset?: number }
  ) => Promise<ConversationPage>
  /** Chooses what the next prompt resumes. Does not spawn anything. */
  selectConversation: (agentId: string, sessionId: string) => Promise<MutationResult>
  /** Clears the selection so the next prompt starts fresh. */
  newConversation: (agentId: string) => Promise<MutationResult>
  renameConversation: (agentId: string, sessionId: string, title: string) => Promise<MutationResult>
  deleteConversation: (agentId: string, sessionId: string) => Promise<MutationResult>
  clearConversations: (agentId: string) => Promise<MutationResult>

  /**
   * Subscription quota for the account, not for one agent.
   *
   * Pulled on mount as well as pushed: the event that carries it arrives with
   * an agent's turn, so a renderer that started afterwards would otherwise
   * show nothing until the next turn ran.
   */
  getQuota: () => Promise<RateLimitStatus | null>
  onQuotaChanged: (listener: (limit: RateLimitStatus | null) => void) => () => void

  /**
   * Whether the machine's Claude Code login is usable. Checked at launch and
   * again on request; `unknown` means the check itself could not run, and
   * agents are still allowed to try.
   */
  getLogin: () => Promise<LoginStatus>
  recheckLogin: () => Promise<LoginStatus>
  onLoginChanged: (listener: (status: LoginStatus) => void) => () => void

  listVoices: () => Promise<SystemVoice[]>
  previewVoice: (
    voiceId: string,
    rate: number,
    provider: 'system' | 'kokoro'
  ) => Promise<MutationResult>
  kokoroStatus: () => Promise<KokoroStatus>
  /** Downloads the neural weights. Resolves when the model is usable. */
  loadKokoro: () => Promise<MutationResult>

  /** Input devices, as the overlay sees them. Empty until it has enumerated. */
  listMicrophones: () => Promise<MicrophoneDevice[]>
  /**
   * Fires when the device list changes.
   *
   * The overlay enumerates, so the list can arrive after the dialog opened —
   * and devices come and go while it is open.
   */
  onMicrophonesChanged: (listener: (devices: MicrophoneDevice[]) => void) => () => void
  /**
   * Opens or closes the microphone for the settings meter.
   *
   * Explicit rather than implicit: this is the only thing in the app that
   * opens the microphone without the user having enabled voice input, so it
   * happens when they press a button and not when a dialog appears.
   */
  setMicrophoneTest: (testing: boolean) => void
  /**
   * Fires with each level while the test runs, and once with null when it
   * stops — including when main stops it on the timeout rather than the user.
   */
  onMicrophoneLevel: (listener: (rms: number | null) => void) => () => void
  sttStatus: () => Promise<SttStatus>
  /** Downloads and loads the speech model. Resolves when it is usable. */
  loadSttModel: () => Promise<MutationResult>
  /**
   * The current failures.
   *
   * Registration happens at launch, before any window has finished loading,
   * and `webContents.send` before that point is dropped — so the broadcast
   * alone would leave a freshly mounted renderer believing everything bound.
   */
  getHotkeyFailures: () => Promise<HotkeyFailure[]>
  onHotkeyFailures: (listener: (failures: HotkeyFailure[]) => void) => () => void

  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<MutationResult>
  /**
   * Fires when settings change outside the dialog — the tray's voice toggle
   * is the one that exists today. Without it an open dialog goes stale and
   * the next save writes the value back.
   */
  onSettingsChanged: (listener: (settings: AppSettings) => void) => () => void

  /** Posix-relative paths under the agent's workspace, for the @ picker. */
  listWorkspaceFiles: (agentId: string) => Promise<string[]>
  /** The absolute path of a dropped File; empty for a pasted blob with none. */
  pathForFile: (file: File) => string

  /** Opens a path (relative to the agent's workspace, or absolute) in the user's editor. */
  openInEditor: (agentId: string, path: string, line?: number) => Promise<MutationResult>
  /**
   * The current diff of one file the agent changed, in the agent's active
   * conversation's checkout. Read-only; the editor owns accept and revert.
   */
  fileDiff: (agentId: string, path: string) => Promise<FileDiffResult>
  /** Whether a folder exists and is a git repository. */
  inspectWorkspace: (path: string, wsl: WslConfig | null) => Promise<WorkspaceInfo>
  /** Installed WSL distros, for the editor's Run in WSL control. Empty off Windows. */
  listWslDistros: () => Promise<WslDistro[]>
}
