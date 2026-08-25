/**
 * MCP server health, as the pane header shows it.
 *
 * Every init message — re-sent each turn — carries `{ name, status }` per
 * server, which is free. `query.mcpServerStatus()` is a control round trip
 * that adds the error text, scope and tools; it is asked for only when
 * something is newly wrong, not on every turn.
 */

export type McpStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'

export type McpServerHealth = {
  name: string
  status: McpStatus
  /** Set when status is `failed`, once detail has been fetched. */
  error?: string
  /** Where the server was configured: project, user, local, claudeai, managed. */
  scope?: string
  toolCount?: number
}

/** Open Room's own in-process server, which carries the `speak` tool. */
export const VOICE_SERVER = 'openroom-voice'

const KNOWN: ReadonlySet<string> = new Set([
  'connected',
  'failed',
  'needs-auth',
  'pending',
  'disabled'
])

const asStatus = (status: string): McpStatus =>
  KNOWN.has(status) ? (status as McpStatus) : 'pending'

/**
 * Folds the init message's statuses into what is known. Detail already
 * fetched survives while a server's status is unchanged; a change drops it,
 * since an error message for a state the server has left is misleading.
 */
export function mcpHealthUpdate(
  prev: McpServerHealth[],
  initServers: { name: string; status: string }[]
): { servers: McpServerHealth[]; fetchDetail: boolean } {
  const before = new Map(prev.map((p) => [p.name, p]))
  let fetchDetail = false

  const servers = initServers.map(({ name, status: raw }): McpServerHealth => {
    const status = asStatus(raw)
    const known = before.get(name)
    if (known && known.status === status) return known
    if (status !== 'connected' && status !== 'disabled') fetchDetail = true
    return { name, status }
  })

  return { servers, fetchDetail }
}

/** Merges the rich control-request status onto the servers it names. */
export function withMcpDetail(
  servers: McpServerHealth[],
  detail: {
    name: string
    status?: string
    error?: string
    scope?: string
    tools?: { name: string }[]
  }[]
): McpServerHealth[] {
  const byName = new Map(detail.map((d) => [d.name, d]))
  return servers.map((server) => {
    const d = byName.get(server.name)
    if (!d) return server
    return {
      ...server,
      ...(d.error ? { error: d.error } : {}),
      ...(d.scope ? { scope: d.scope } : {}),
      ...(d.tools ? { toolCount: d.tools.length } : {})
    }
  })
}

export type McpSeverity = 'ok' | 'warn' | 'error'

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * One line for the header, or nothing when there is nothing to say. The
 * common case is every server connected, and that should cost no pixels.
 */
export function summarizeMcp(servers: McpServerHealth[]): {
  severity: McpSeverity
  label: string | null
} {
  const voice = servers.find((s) => s.name === VOICE_SERVER)
  if (voice && voice.status !== 'connected') {
    return { severity: 'error', label: 'Voice tool unavailable' }
  }

  const failed = servers.filter((s) => s.status === 'failed').length
  if (failed > 0) return { severity: 'error', label: `${plural(failed, 'MCP server')} failed` }

  const needsAuth = servers.filter((s) => s.status === 'needs-auth').length
  if (needsAuth > 0) {
    return { severity: 'warn', label: `${plural(needsAuth, 'MCP server')} needs auth` }
  }

  const pending = servers.filter((s) => s.status === 'pending').length
  if (pending > 0) return { severity: 'warn', label: `${plural(pending, 'MCP server')} pending` }

  return { severity: 'ok', label: null }
}
