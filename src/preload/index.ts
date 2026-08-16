import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Agent } from '@shared/agent'
import type {
  AgentRuntime,
  PermissionDecision,
  PermissionRequest,
  TranscriptEntry
} from '@shared/agent-runtime'
import type { AppSettings } from '@shared/settings'
import {
  IpcChannel,
  type AgentsSnapshot,
  type AppInfo,
  type MutationResult,
  type OpenRoomApi
} from '@shared/ipc'

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

  sendPrompt: (agentId: string, text: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.sendPrompt, agentId, text),

  interruptAgent: (agentId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.interruptAgent, agentId),

  stopAgent: (agentId: string): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.stopAgent, agentId),

  listRuntimes: (): Promise<AgentRuntime[]> => ipcRenderer.invoke(IpcChannel.listRuntimes),

  onRuntimeChanged: (listener: (runtime: AgentRuntime) => void): (() => void) =>
    subscribe(IpcChannel.runtimeChanged, (runtime) => listener(runtime as AgentRuntime)),

  onTranscriptAppended: (listener: (entry: TranscriptEntry) => void): (() => void) =>
    subscribe(IpcChannel.transcriptAppended, (entry) => listener(entry as TranscriptEntry)),

  onPermissionRequested: (listener: (request: PermissionRequest) => void): (() => void) =>
    subscribe(IpcChannel.permissionRequested, (r) => listener(r as PermissionRequest)),

  onPermissionResolved: (listener: (requestId: string) => void): (() => void) =>
    subscribe(IpcChannel.permissionResolved, (id) => listener(id as string)),

  respondPermission: (requestId: string, decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.respondPermission, requestId, decision),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannel.getSettings),

  saveSettings: (settings: AppSettings): Promise<MutationResult> =>
    ipcRenderer.invoke(IpcChannel.saveSettings, settings)
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
