import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Agent } from '@shared/agent'
import type { ImageAttachment } from '@shared/attachments'
import type {
  AgentRuntime,
  PermissionDecision,
  PermissionRequest,
  RateLimitStatus,
  TranscriptEntry
} from '@shared/agent-runtime'
import type { Conversation, ConversationPage } from '@shared/conversation'
import type { SessionOverridePatch } from '@shared/session-overrides'
import type { LoginStatus } from '@shared/login'
import type { AppSettings } from '@shared/settings'
import type { KokoroStatus, SttStatus, SystemVoice } from '@shared/voice-rpc'
import type { HotkeyFailure } from '@shared/hotkeys'
import type { MicrophoneDevice } from '@shared/voice-input'
import {
  IpcChannel,
  type AgentsSnapshot,
  type AppInfo,
  type MutationResult,
  type OpenRoomApi
} from '@shared/ipc'
import type { FileDiffResult, WorkspaceInfo } from '@shared/ipc'

/**
 * The only bridge between renderer and main. Every method here must map to a
 * channel declared in `@shared/ipc` and handled in `src/main/ipc.ts`.
 *
 * Never expose `ipcRenderer` itself — that would hand the renderer an
 * unrestricted channel into main.
 */
const openRoom: OpenRoomApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannel.getAppInfo),

  listAgents: (): Promise<AgentsSnapshot> => ipcRenderer.invoke(IpcChannel.listAgents),

  createAgent: (agent: Agent): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.createAgent, agent),

  updateAgent: (agent: Agent): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.updateAgent, agent),

  deleteAgent: (id: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.deleteAgent, id),

  pickWorkspace: (): Promise<string | null> => ipcRenderer.invoke(IpcChannel.pickWorkspace),

  onAgentsChanged: (listener: () => void): (() => void) =>
    subscribe(IpcChannel.agentsChanged, () => listener()),

  selectAgent: (agentId: string | null): void => {
    ipcRenderer.send(IpcChannel.selectAgent, agentId)
  },

  onFocusAgent: (listener: (agentId: string) => void): (() => void) =>
    subscribe(IpcChannel.focusAgent, (payload) => listener(payload as string)),

  sendPrompt: (
    agentId: string,
    text: string,
    images: ImageAttachment[] = []
  ): Promise<MutationResult> => ipcRenderer.invoke(IpcChannel.sendPrompt, agentId, text, images),

  interruptAgent: (agentId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.interruptAgent, agentId),

  dropQueuedPrompt: (agentId: string, id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.dropQueuedPrompt, agentId, id),

  setOverrides: (agentId: string, patch: SessionOverridePatch): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.setOverrides, agentId, patch),

  stopAgent: (agentId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.stopAgent, agentId),

  listRuntimes: (): Promise<AgentRuntime[]> => ipcRenderer.invoke(IpcChannel.listRuntimes),

  onRuntimeChanged: (listener: (runtime: AgentRuntime) => void): (() => void) =>
    subscribe(IpcChannel.runtimeChanged, (runtime) => listener(runtime as AgentRuntime)),

  onTranscriptAppended: (listener: (entry: TranscriptEntry) => void): (() => void) =>
    subscribe(IpcChannel.transcriptAppended, (entry) => listener(entry as TranscriptEntry)),

  onTranscriptCleared: (listener: (agentId: string) => void): (() => void) =>
    subscribe(IpcChannel.transcriptCleared, (id) => listener(id as string)),

  onPermissionRequested: (listener: (request: PermissionRequest) => void): (() => void) =>
    subscribe(IpcChannel.permissionRequested, (r) => listener(r as PermissionRequest)),

  onPermissionResolved: (listener: (requestId: string) => void): (() => void) =>
    subscribe(IpcChannel.permissionResolved, (id) => listener(id as string)),

  respondPermission: (requestId: string, decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.respondPermission, requestId, decision),

  listConversations: (agentId: string): Promise<Conversation[]> =>
    ipcRenderer.invoke(IpcChannel.listConversations, agentId),

  loadConversation: (
    agentId: string,
    sessionId: string,
    options: { limit: number; offset?: number }
  ): Promise<ConversationPage> =>
    ipcRenderer.invoke(IpcChannel.loadConversation, agentId, sessionId, options),

  selectConversation: (agentId: string, sessionId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.selectConversation, agentId, sessionId),

  newConversation: (agentId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.newConversation, agentId),

  renameConversation: (
    agentId: string,
    sessionId: string,
    title: string
  ): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.renameConversation, agentId, sessionId, title),

  deleteConversation: (agentId: string, sessionId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.deleteConversation, agentId, sessionId),

  clearConversations: (agentId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.clearConversations, agentId),

  listVoices: (): Promise<SystemVoice[]> => ipcRenderer.invoke(IpcChannel.listVoices),

  getQuota: (): Promise<RateLimitStatus | null> => ipcRenderer.invoke(IpcChannel.getQuota),
  getLogin: (): Promise<LoginStatus> => ipcRenderer.invoke(IpcChannel.getLogin),
  recheckLogin: (): Promise<LoginStatus> => ipcRenderer.invoke(IpcChannel.recheckLogin),
  onLoginChanged: (listener: (status: LoginStatus) => void) =>
    subscribe(IpcChannel.loginChanged, (payload) => listener(payload as LoginStatus)),
  onQuotaChanged: (listener: (limit: RateLimitStatus | null) => void) =>
    subscribe(IpcChannel.quotaChanged, (payload) => listener(payload as RateLimitStatus | null)),

  previewVoice: (
    voiceId: string,
    rate: number,
    provider: 'system' | 'kokoro'
  ): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.previewVoice, voiceId, rate, provider),

  kokoroStatus: (): Promise<KokoroStatus> => ipcRenderer.invoke(IpcChannel.kokoroStatus),

  loadKokoro: (): Promise<MutationResult> => ipcRenderer.invoke(IpcChannel.loadKokoro),

  listMicrophones: (): Promise<MicrophoneDevice[]> =>
    ipcRenderer.invoke(IpcChannel.listMicrophones),

  onMicrophonesChanged: (listener: (devices: MicrophoneDevice[]) => void): (() => void) =>
    subscribe(IpcChannel.microphonesChanged, (payload) => listener(payload as MicrophoneDevice[])),

  setMicrophoneTest: (testing: boolean): void => {
    ipcRenderer.send(IpcChannel.setMicrophoneTest, testing)
  },

  onMicrophoneLevel: (listener: (rms: number | null) => void): (() => void) =>
    subscribe(IpcChannel.microphoneLevel, (payload) => listener(payload as number | null)),

  sttStatus: (): Promise<SttStatus> => ipcRenderer.invoke(IpcChannel.sttStatus),

  loadSttModel: (): Promise<MutationResult> => ipcRenderer.invoke(IpcChannel.loadSttModel),

  getHotkeyFailures: (): Promise<HotkeyFailure[]> =>
    ipcRenderer.invoke(IpcChannel.getHotkeyFailures),

  onHotkeyFailures: (listener: (failures: HotkeyFailure[]) => void): (() => void) =>
    subscribe(IpcChannel.hotkeyFailures, (payload) => listener(payload as HotkeyFailure[])),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannel.getSettings),

  saveSettings: (settings: AppSettings): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.saveSettings, settings),

  onSettingsChanged: (listener: (settings: AppSettings) => void): (() => void) =>
    subscribe(IpcChannel.settingsChanged, (payload) => listener(payload as AppSettings)),

  listWorkspaceFiles: (agentId: string): Promise<string[]> =>
    ipcRenderer.invoke(IpcChannel.listWorkspaceFiles, agentId),

  // `File.path` was removed in Electron 32; this is the sanctioned way.
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  openInEditor: (agentId: string, path: string, line?: number): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.openInEditor, agentId, path, line),

  fileDiff: (agentId: string, path: string): Promise<FileDiffResult> =>
    ipcRenderer.invoke(IpcChannel.fileDiff, agentId, path),

  inspectWorkspace: (path: string): Promise<WorkspaceInfo> =>
    ipcRenderer.invoke(IpcChannel.inspectWorkspace, path)
}

/**
 * Wraps an `ipcRenderer.on` subscription.
 *
 * The IpcRendererEvent is deliberately never forwarded — handing the renderer
 * an object with a live `sender` would leak an unrestricted IPC handle back
 * across the bridge, defeating the point of the preload boundary.
 */
function subscribe(channel: string, forward: (payload: unknown) => void): () => void {
  const handler = (_event: unknown, payload: unknown): void => forward(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled; refusing to expose the API without it.')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('openRoom', openRoom)
