import type { Agent } from './agent'
import type {
  AgentRuntime,
  PermissionDecision,
  PermissionRequest,
  TranscriptEntry
} from './agent-runtime'
import type { Conversation, ConversationPage } from './conversation'
import type { HotkeyFailure } from './hotkeys'
import type { AppSettings } from './settings'
import type { KokoroStatus, SttStatus, SystemVoice } from './voice-rpc'

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
  /** overlay → main, what the endpointer observed. */
  overlayEvent: 'overlay:event',
  /** overlay → main, pointer entered or left the bubble; pauses dismissal. */
  overlayHover: 'overlay:hover',
  /** main → overlay, one pip per working or blocked agent. */
  overlayPips: 'overlay:pips',
  /** overlay → main, raise the main window on this agent. */
  overlaySelectAgent: 'overlay:select-agent',
  /** main → renderer, select this agent, from a clicked pip. */
  focusAgent: 'app:focus-agent'
} as const

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

  /** Starts the agent's session if needed, then queues the prompt. */
  sendPrompt: (agentId: string, text: string) => Promise<MutationResult>
  /** Stops the current turn, leaving the session alive. */
  interruptAgent: (agentId: string) => Promise<MutationResult>
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

  listVoices: () => Promise<SystemVoice[]>
  previewVoice: (
    voiceId: string,
    rate: number,
    provider: 'system' | 'kokoro'
  ) => Promise<MutationResult>
  kokoroStatus: () => Promise<KokoroStatus>
  /** Downloads the neural weights. Resolves when the model is usable. */
  loadKokoro: () => Promise<MutationResult>

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
}
