import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Agent } from '@shared/agent'
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

  onAgentsChanged: (listener: () => void): (() => void) => {
    // The IpcRendererEvent is deliberately not forwarded — handing the
    // renderer an event object with a `sender` would leak an IPC handle
    // back across the bridge.
    const handler = (): void => listener()
    ipcRenderer.on(IpcChannel.agentsChanged, handler)
    return () => ipcRenderer.off(IpcChannel.agentsChanged, handler)
  }
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled; refusing to expose the API without it.')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('openRoom', openRoom)
