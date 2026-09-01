/**
 * The wire between main and the sessions worker: one JSON value per line
 * on stdio, the same shape as the voice sidecar. The worker exists so the
 * SDK's session functions can run with a different CLAUDE_CONFIG_DIR than
 * main's, which the SDK reads live and forwards to every CLI it spawns.
 */

export type SessionRequest =
  | {
      id: number
      method: 'list'
      params: { dir: string; limit: number; includeWorktrees: boolean }
    }
  | { id: number; method: 'messages'; params: { sessionId: string; dir: string } }
  | { id: number; method: 'rename'; params: { sessionId: string; dir: string; title: string } }
  | { id: number; method: 'tag'; params: { sessionId: string; dir: string; tag: string | null } }
  | { id: number; method: 'delete'; params: { sessionId: string; dir: string } }

export type SessionResponse = { id: number; result?: unknown; error?: string }

export function encodeLine(value: unknown): string {
  return JSON.stringify(value) + '\n'
}

export function decodeLines(buffer: string): { messages: unknown[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const messages: unknown[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      messages.push(JSON.parse(line))
    } catch {
      // A malformed line is dropped; the stream must survive it.
    }
  }
  return { messages, rest }
}
