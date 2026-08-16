import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannel, type AppInfo, type OpenRoomApi } from '@shared/ipc'

/**
 * The only bridge between renderer and main. Every method here must map to a
 * channel declared in `@shared/ipc` and handled in `src/main/ipc.ts`.
 *
 * Never expose `ipcRenderer` itself — that would hand the renderer an
 * unrestricted channel into main.
 */
const openRoom: OpenRoomApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannel.getAppInfo)
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled; refusing to expose the API without it.')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('openRoom', openRoom)
