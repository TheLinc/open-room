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

export const IpcChannel = {
  getAppInfo: 'app:get-info'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

/**
 * The surface exposed on `window.openRoom` by the preload script.
 * Keep this in sync with `src/preload/index.ts`.
 */
export type OpenRoomApi = {
  getAppInfo: () => Promise<AppInfo>
}
