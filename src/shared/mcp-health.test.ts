import { describe, expect, it } from 'vitest'
import { mcpHealthUpdate, summarizeMcp, withMcpDetail, type McpServerHealth } from './mcp-health'

const s = (name: string, status: McpServerHealth['status']): McpServerHealth => ({ name, status })

describe('mcpHealthUpdate', () => {
  it('takes the per-turn statuses from the init message', () => {
    const { servers } = mcpHealthUpdate([], [{ name: 'github', status: 'connected' }])
    expect(servers).toEqual([s('github', 'connected')])
  })

  it('asks for detail when a server is newly not connected', () => {
    const { fetchDetail } = mcpHealthUpdate([], [{ name: 'github', status: 'failed' }])
    expect(fetchDetail).toBe(true)
  })

  it('does not ask again while the same servers stay in the same state', () => {
    const prev = [{ ...s('github', 'failed'), error: 'spawn ENOENT' }]
    const { servers, fetchDetail } = mcpHealthUpdate(prev, [{ name: 'github', status: 'failed' }])
    expect(fetchDetail).toBe(false)
    expect(servers[0].error).toBe('spawn ENOENT')
  })

  it('drops stale detail when a server changes state', () => {
    const prev = [{ ...s('github', 'failed'), error: 'spawn ENOENT' }]
    const { servers } = mcpHealthUpdate(prev, [{ name: 'github', status: 'connected' }])
    expect(servers).toEqual([s('github', 'connected')])
  })

  it('does not ask for detail when everything is connected', () => {
    expect(mcpHealthUpdate([], [{ name: 'a', status: 'connected' }]).fetchDetail).toBe(false)
    expect(mcpHealthUpdate([], []).fetchDetail).toBe(false)
  })

  it('treats a status it does not know as pending rather than crashing', () => {
    const { servers } = mcpHealthUpdate([], [{ name: 'x', status: 'warming-up' }])
    expect(servers).toEqual([s('x', 'pending')])
  })
})

describe('withMcpDetail', () => {
  it('copies error, scope and tool count from the rich status onto the matching server', () => {
    const servers = [s('github', 'failed'), s('fs', 'connected')]
    const detailed = withMcpDetail(servers, [
      { name: 'github', status: 'failed', error: 'spawn ENOENT', scope: 'project' },
      { name: 'fs', status: 'connected', tools: [{ name: 'read' }, { name: 'write' }] }
    ])
    expect(detailed).toEqual([
      { name: 'github', status: 'failed', error: 'spawn ENOENT', scope: 'project' },
      { name: 'fs', status: 'connected', toolCount: 2 }
    ])
  })

  it('leaves a server alone when the rich status does not mention it', () => {
    expect(withMcpDetail([s('github', 'pending')], [])).toEqual([s('github', 'pending')])
  })
})

describe('summarizeMcp', () => {
  it('is ok with no servers', () => {
    expect(summarizeMcp([])).toEqual({ severity: 'ok', label: null })
  })

  it('is ok when every server is connected', () => {
    expect(summarizeMcp([s('a', 'connected'), s('openroom-voice', 'connected')])).toEqual({
      severity: 'ok',
      label: null
    })
  })

  it('reports a failure as an error, counting them', () => {
    expect(summarizeMcp([s('a', 'failed'), s('b', 'failed'), s('c', 'connected')])).toEqual({
      severity: 'error',
      label: '2 MCP servers failed'
    })
    expect(summarizeMcp([s('a', 'failed')]).label).toBe('1 MCP server failed')
  })

  it('reports needs-auth and pending as warnings', () => {
    expect(summarizeMcp([s('a', 'needs-auth')])).toEqual({
      severity: 'warn',
      label: '1 MCP server needs auth'
    })
    expect(summarizeMcp([s('a', 'pending')])).toEqual({
      severity: 'warn',
      label: '1 MCP server pending'
    })
  })

  it('lets a failure outrank a warning in the label', () => {
    expect(summarizeMcp([s('a', 'failed'), s('b', 'pending')])).toEqual({
      severity: 'error',
      label: '1 MCP server failed'
    })
  })

  it('ignores a disabled server', () => {
    expect(summarizeMcp([s('a', 'disabled')]).severity).toBe('ok')
  })

  it("treats Open Room's own voice server not being connected as an error", () => {
    // speak is broken if this is not up, whatever the status says.
    expect(summarizeMcp([s('openroom-voice', 'pending')])).toEqual({
      severity: 'error',
      label: 'Voice tool unavailable'
    })
  })
})
