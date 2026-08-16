import type { ElectronAPI } from '@electron-toolkit/preload'
import type { OpenRoomApi } from '@shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    openRoom: OpenRoomApi
  }
}

export {}
