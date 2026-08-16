import { app, ipcMain } from 'electron'
import { IpcChannel, type AppInfo } from '@shared/ipc'

/**
 * Registers every main-process IPC handler. Called once on app ready.
 *
 * One handler per channel in `@shared/ipc`. Handlers must be cheap and
 * non-blocking — anything long-running belongs on a supervisor that streams
 * results back, not on an `invoke` round trip.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.getAppInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform as AppInfo['platform']
    }
  })
}
