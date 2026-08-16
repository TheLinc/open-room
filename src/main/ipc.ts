import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { agentConfigSchema, slugifyAgentName, type Agent } from '@shared/agent'
import { IpcChannel, type AgentsSnapshot, type AppInfo, type MutationResult } from '@shared/ipc'
import { ConfigStore } from './config-store'

/**
 * Registers every main-process IPC handler. Called once on app ready.
 *
 * One handler per channel in `@shared/ipc`. Handlers must be cheap and
 * non-blocking — anything long-running belongs on a supervisor that streams
 * results back, not on an `invoke` round trip.
 */
export function registerIpcHandlers(store: ConfigStore): void {
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

  ipcMain.handle(IpcChannel.listAgents, async (): Promise<AgentsSnapshot> => {
    return store.list()
  })

  ipcMain.handle(IpcChannel.createAgent, async (_e, agent: Agent): Promise<MutationResult> => {
    return guard(async () => {
      const id = slugifyAgentName(agent.config.name)
      if (!id) throw new Error('Name must contain at least one letter or number.')
      if (await store.exists(id)) {
        throw new Error(`An agent named “${agent.config.name}” already exists.`)
      }
      await store.write({ ...agent, config: { ...agent.config, id } })
    })
  })

  ipcMain.handle(IpcChannel.updateAgent, async (_e, agent: Agent): Promise<MutationResult> => {
    return guard(async () => {
      // The id is the directory and never changes on rename — renaming an
      // agent would otherwise orphan its directory and its sessions.
      const parsed = agentConfigSchema.parse(agent.config)
      if (!(await store.exists(parsed.id))) {
        throw new Error('That agent no longer exists on disk.')
      }
      await store.write({ ...agent, config: parsed })
    })
  })

  ipcMain.handle(IpcChannel.deleteAgent, async (_e, id: string): Promise<MutationResult> => {
    return guard(() => store.delete(id))
  })

  ipcMain.handle(IpcChannel.pickWorkspace, async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose a workspace folder',
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

/** Broadcasts an on-disk change to every open window. */
export function broadcastAgentsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IpcChannel.agentsChanged)
  }
}

/**
 * Converts a thrown error into a message the renderer can show directly.
 * Zod errors get flattened to their first issue — the raw `ZodError` string is
 * a JSON dump, which is not a user-facing message.
 */
async function guard(fn: () => Promise<void> | void): Promise<MutationResult> {
  try {
    await fn()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues
    const first = issues[0]
    if (first) {
      const path = first.path.join('.')
      return path ? `${path}: ${first.message}` : first.message
    }
  }
  return error instanceof Error ? error.message : String(error)
}
