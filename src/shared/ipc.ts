import type { Agent } from './agent'

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

/** A directory under `~/.open-room/agents` that exists but failed to load. */
export type AgentLoadError = {
  id: string
  message: string
}

export type AgentsSnapshot = {
  agents: Agent[]
  errors: AgentLoadError[]
}

/**
 * Mutations report failure in the result rather than throwing across IPC —
 * an `invoke` rejection arrives in the renderer as an opaque string with the
 * main-process stack glued on, which is not something to show a user.
 */
export type MutationResult = { ok: true } | { ok: false; message: string }

export const IpcChannel = {
  getAppInfo: 'app:get-info',
  listAgents: 'agents:list',
  createAgent: 'agents:create',
  updateAgent: 'agents:update',
  deleteAgent: 'agents:delete',
  pickWorkspace: 'agents:pick-workspace',
  /** main → renderer, fired when the agents directory changes on disk. */
  agentsChanged: 'agents:changed'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

/**
 * The surface exposed on `window.openRoom` by the preload script.
 * Keep this in sync with `src/preload/index.ts`.
 */
export type OpenRoomApi = {
  getAppInfo: () => Promise<AppInfo>
  listAgents: () => Promise<AgentsSnapshot>
  createAgent: (agent: Agent) => Promise<MutationResult>
  updateAgent: (agent: Agent) => Promise<MutationResult>
  deleteAgent: (id: string) => Promise<MutationResult>
  /** Opens a native directory picker. Resolves null if cancelled. */
  pickWorkspace: () => Promise<string | null>
  /** Subscribes to on-disk changes. Returns an unsubscribe function. */
  onAgentsChanged: (listener: () => void) => () => void
}
