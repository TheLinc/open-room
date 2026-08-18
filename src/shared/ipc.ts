import type { Agent } from './agent'
import type {
  AgentRuntime,
  PermissionDecision,
  PermissionRequest,
  TranscriptEntry
} from './agent-runtime'
import type { Conversation, ConversationPage } from './conversation'
import type { AppSettings } from './settings'
import type { KokoroStatus, SystemVoice } from './voice-rpc'

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

  getSettings: 'settings:get',
  saveSettings: 'settings:save',

  /** main → overlay, the whole overlay state on every change. */
  overlayState: 'overlay:state',
  /** overlay → main, accept clicks while the pointer is over the bubble. */
  overlaySetInteractive: 'overlay:set-interactive',
  /** main → overlay, open the microphone. */
  overlayStartCapture: 'overlay:start-capture',
  /** main → overlay, flush the audio and send it back. */
  overlayStopCapture: 'overlay:stop-capture',
  /** main → overlay, close the microphone and throw the audio away. */
  overlayDiscardCapture: 'overlay:discard-capture',
  /** overlay → main, the finished capture as base64 PCM. */
  overlayAudio: 'overlay:audio',
  /** overlay → main, what the endpointer observed. */
  overlayEvent: 'overlay:event',
  /** overlay → main, pointer entered or left the bubble; pauses dismissal. */
  overlayHover: 'overlay:hover'
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

  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<MutationResult>
}
