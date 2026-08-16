import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { agentConfigSchema, slugifyAgentName, type Agent } from '@shared/agent'
import type {
  AgentRuntime,
  PermissionDecision,
  PermissionRequest,
  TranscriptEntry
} from '@shared/agent-runtime'
import { appSettingsSchema, type AppSettings } from '@shared/settings'
import { IpcChannel, type AgentsSnapshot, type AppInfo, type MutationResult } from '@shared/ipc'
import { ConfigStore } from './config-store'
import type { AgentSupervisor } from './agent-supervisor'
import type { ConversationStore } from './conversation-store'
import type { Conversation, ConversationPage } from '@shared/conversation'

/**
 * Registers every main-process IPC handler. Called once on app ready.
 *
 * One handler per channel in `@shared/ipc`. Handlers must be cheap and
 * non-blocking — anything long-running belongs on a supervisor that streams
 * results back, not on an `invoke` round trip.
 */
export function registerIpcHandlers(
  store: ConfigStore,
  supervisor: AgentSupervisor,
  conversations: ConversationStore
): void {
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

  ipcMain.handle(
    IpcChannel.sendPrompt,
    async (_e, agentId: string, text: string): Promise<MutationResult> => {
      // Config is re-read per prompt so edits made in the editor — or in the
      // file directly — take effect on the next turn without a restart.
      try {
        const agent = await store.read(agentId)
        return await supervisor.send(agent, text)
      } catch (error) {
        return { ok: false, message: describeError(error) }
      }
    }
  )

  ipcMain.handle(
    IpcChannel.interruptAgent,
    async (_e, agentId: string): Promise<MutationResult> => {
      return guard(() => supervisor.interrupt(agentId))
    }
  )

  ipcMain.handle(IpcChannel.stopAgent, async (_e, agentId: string): Promise<MutationResult> => {
    return guard(() => supervisor.stop(agentId))
  })

  ipcMain.handle(IpcChannel.listRuntimes, (): AgentRuntime[] => supervisor.allRuntimes())

  ipcMain.handle(
    IpcChannel.respondPermission,
    (_e, requestId: string, decision: PermissionDecision): void => {
      supervisor.respondToPermission(requestId, decision)
    }
  )

  ipcMain.handle(
    IpcChannel.listConversations,
    async (_e, agentId: string): Promise<Conversation[]> => {
      const agent = await store.read(agentId).catch(() => null)
      return agent ? conversations.list(agent) : []
    }
  )

  ipcMain.handle(
    IpcChannel.loadConversation,
    async (
      _e,
      agentId: string,
      sessionId: string,
      options: { limit: number; offset?: number }
    ): Promise<ConversationPage> => {
      const agent = await store.read(agentId).catch(() => null)
      if (!agent) return { sessionId, total: 0, offset: 0, messages: [] }
      return conversations.page(agent, sessionId, options)
    }
  )

  ipcMain.handle(
    IpcChannel.selectConversation,
    async (_e, agentId: string, sessionId: string): Promise<MutationResult> =>
      guard(async () => {
        // Switching conversations mid-session would leave the live subprocess
        // attached to the previous one, so the session is torn down first and
        // the next prompt resumes the chosen conversation.
        await supervisor.stop(agentId)
        supervisor.setActiveConversation(agentId, sessionId)
      })
  )

  ipcMain.handle(IpcChannel.newConversation, async (_e, agentId: string): Promise<MutationResult> =>
    guard(async () => {
      await supervisor.stop(agentId)
      supervisor.setActiveConversation(agentId, null)
    })
  )

  ipcMain.handle(
    IpcChannel.renameConversation,
    async (_e, agentId: string, sessionId: string, title: string): Promise<MutationResult> =>
      guard(async () => {
        const agent = await store.read(agentId)
        await conversations.rename(agent, sessionId, title.trim() || 'Untitled')
      })
  )

  ipcMain.handle(
    IpcChannel.deleteConversation,
    async (_e, agentId: string, sessionId: string): Promise<MutationResult> =>
      guard(async () => {
        const agent = await store.read(agentId)
        if (supervisor.runtimeFor(agentId).activeConversationId === sessionId) {
          await supervisor.stop(agentId)
          supervisor.setActiveConversation(agentId, null)
        }
        await conversations.remove(agent, sessionId)
      })
  )

  ipcMain.handle(
    IpcChannel.clearConversations,
    async (_e, agentId: string): Promise<MutationResult> =>
      guard(async () => {
        const agent = await store.read(agentId)
        await supervisor.stop(agentId)
        supervisor.setActiveConversation(agentId, null)
        await conversations.removeAll(agent)
      })
  )

  ipcMain.handle(IpcChannel.getSettings, (): Promise<AppSettings> => store.readSettings())

  ipcMain.handle(IpcChannel.saveSettings, async (_e, settings: AppSettings) => {
    return guard(async () => {
      const parsed = appSettingsSchema.parse(settings)
      await store.writeSettings(parsed)
      supervisor.setOptions({ maxConcurrent: parsed.maxConcurrentAgents })
    })
  })
}

export function broadcastRuntime(runtime: AgentRuntime): void {
  broadcast(IpcChannel.runtimeChanged, runtime)
}

export function broadcastTranscript(entry: TranscriptEntry): void {
  broadcast(IpcChannel.transcriptAppended, entry)
}

export function broadcastTranscriptCleared(agentId: string): void {
  broadcast(IpcChannel.transcriptCleared, agentId)
}

export function broadcastPermissionRequest(request: PermissionRequest): void {
  broadcast(IpcChannel.permissionRequested, request)
}

export function broadcastPermissionResolved(requestId: string): void {
  broadcast(IpcChannel.permissionResolved, requestId)
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
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
