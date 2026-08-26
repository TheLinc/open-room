import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { agentConfigSchema, slugifyAgentName, type Agent } from '@shared/agent'
import type {
  AgentRuntime,
  RateLimitStatus,
  PermissionDecision,
  PermissionRequest,
  TranscriptEntry
} from '@shared/agent-runtime'
import type { HotkeyFailure } from '@shared/hotkeys'
import type { MicrophoneDevice } from '@shared/voice-input'
import { appSettingsSchema, type AppSettings } from '@shared/settings'
import { sanitizeOverrides } from '@shared/session-overrides'
import { acceptImage, type ImageAttachment } from '@shared/attachments'
import type { LoginStatus } from '@shared/login'
import { IpcChannel, type AgentsSnapshot, type AppInfo, type MutationResult } from '@shared/ipc'
import { ConfigStore } from './config-store'
import type { AgentSupervisor } from './agent-supervisor'
import type { ConversationStore } from './conversation-store'
import type { VoiceSidecar } from './voice-sidecar'
import type { KokoroStatus, SttStatus, SystemVoice } from '@shared/voice-rpc'
import type { Conversation, ConversationPage } from '@shared/conversation'
import { WorkspaceIndex } from './workspace-index'

const workspaceIndex = new WorkspaceIndex()

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
  conversations: ConversationStore,
  voice: VoiceSidecar,
  /** Called after settings are written, so hotkeys and the tray can follow. */
  onSettingsSaved: (settings: AppSettings) => void = () => {},
  /**
   * Current account quota. Read on demand rather than captured, because a
   * renderer can mount long after the event that last set it.
   */
  readQuota: () => RateLimitStatus | null = () => null,
  login: { read: () => LoginStatus; recheck: () => Promise<LoginStatus> } = {
    read: () => ({ state: 'unknown' }),
    recheck: async () => ({ state: 'unknown' })
  }
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
    async (
      _e,
      agentId: string,
      text: string,
      images: ImageAttachment[] = []
    ): Promise<MutationResult> => {
      // Config is re-read per prompt so edits made in the editor — or in the
      // file directly — take effect on the next turn without a restart.
      try {
        const agent = await store.read(agentId)
        // The renderer already applied the limits; re-check here because a
        // renderer is not a trust boundary and a 50 MB message would wedge IPC.
        for (const [i, image] of images.entries()) {
          const verdict = acceptImage({ type: image.mediaType, size: image.data.length * 0.75 }, i)
          if (!verdict.ok) return { ok: false, message: verdict.reason }
        }
        return await supervisor.send(agent, text, images)
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

  ipcMain.handle(
    IpcChannel.setOverrides,
    async (_e, agentId: string, patch: unknown): Promise<MutationResult> => {
      // Sanitised here rather than trusted from the renderer: permission mode
      // is a privilege boundary, and bypassPermissions must not be reachable
      // by anything that can reach this channel.
      return guard(() => supervisor.setOverrides(agentId, sanitizeOverrides(patch)))
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

  ipcMain.handle(IpcChannel.getQuota, (): RateLimitStatus | null => readQuota())
  ipcMain.handle(IpcChannel.getLogin, (): LoginStatus => login.read())
  ipcMain.handle(IpcChannel.recheckLogin, (): Promise<LoginStatus> => login.recheck())

  ipcMain.handle(IpcChannel.listVoices, async (): Promise<SystemVoice[]> => {
    return voice.listVoices().catch(() => [])
  })

  ipcMain.handle(
    IpcChannel.previewVoice,
    async (
      _e,
      voiceId: string,
      rate: number,
      provider: 'system' | 'kokoro'
    ): Promise<MutationResult> =>
      guard(() => voice.speak('This is how this agent will sound.', { voiceId, rate, provider }))
  )

  ipcMain.handle(IpcChannel.kokoroStatus, async (): Promise<KokoroStatus> => {
    return voice.kokoroStatus().catch(() => ({ loaded: false, installed: false }))
  })

  ipcMain.handle(IpcChannel.loadKokoro, async (): Promise<MutationResult> => {
    return guard(() => voice.loadKokoro())
  })

  ipcMain.handle(IpcChannel.sttStatus, async (): Promise<SttStatus> => {
    // A sidecar that is down means "not installed" for the UI's purposes:
    // nothing can be transcribed either way, and the dialog's job is to say
    // voice input cannot work, not to explain why.
    return voice.sttStatus().catch(() => ({ loaded: false, installed: false }) satisfies SttStatus)
  })

  ipcMain.handle(IpcChannel.loadSttModel, async (): Promise<MutationResult> => {
    return guard(() => voice.loadStt())
  })

  ipcMain.handle(IpcChannel.getSettings, (): Promise<AppSettings> => store.readSettings())

  ipcMain.handle(IpcChannel.saveSettings, async (_e, settings: AppSettings) => {
    return guard(async () => {
      const parsed = appSettingsSchema.parse(settings)
      await store.writeSettings(parsed)
      supervisor.setOptions({ maxConcurrent: parsed.maxConcurrentAgents })
      onSettingsSaved(parsed)
    })
  })

  ipcMain.handle(IpcChannel.listWorkspaceFiles, async (_e, agentId: string): Promise<string[]> => {
    const agent = await store.read(agentId).catch(() => null)
    return agent ? workspaceIndex.files(agent.config.workspacePath) : []
  })
}

export function broadcastRuntime(runtime: AgentRuntime): void {
  broadcast(IpcChannel.runtimeChanged, runtime)
}

export function broadcastQuota(limit: RateLimitStatus | null): void {
  broadcast(IpcChannel.quotaChanged, limit)
}

export function broadcastLogin(status: LoginStatus): void {
  broadcast(IpcChannel.loginChanged, status)
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

export function broadcastHotkeyFailures(failures: HotkeyFailure[]): void {
  broadcast(IpcChannel.hotkeyFailures, failures)
}

export function broadcastMicrophones(devices: MicrophoneDevice[]): void {
  broadcast(IpcChannel.microphonesChanged, devices)
}

/** One reading for the settings meter, or null once the test has stopped. */
export function broadcastMicrophoneLevel(rms: number | null): void {
  broadcast(IpcChannel.microphoneLevel, rms)
}

export function broadcastSettingsChanged(settings: AppSettings): void {
  broadcast(IpcChannel.settingsChanged, settings)
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
