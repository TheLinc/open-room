import {
  deleteSession,
  getSessionMessages,
  listSessions,
  renameSession,
  tagSession
} from '@anthropic-ai/claude-agent-sdk'
import {
  decodeLines,
  encodeLine,
  type SessionRequest,
  type SessionResponse
} from '@shared/session-rpc'

/**
 * The sessions worker.
 *
 * Runs the SDK's session functions in a process whose CLAUDE_CONFIG_DIR is
 * set by whoever spawned it (main sets it to a WSL distro's ~/.claude over
 * \\wsl.localhost). Main cannot set that variable itself: the SDK reads it
 * live and forwards it to every CLI it spawns, so a host agent starting
 * while it was set would inherit the wrong config directory.
 *
 * stdout carries the protocol and nothing else; diagnostics go to stderr.
 */

async function handle(request: SessionRequest): Promise<unknown> {
  switch (request.method) {
    case 'list':
      return listSessions(request.params)
    case 'messages':
      return getSessionMessages(request.params.sessionId, { dir: request.params.dir })
    case 'rename':
      return renameSession(request.params.sessionId, request.params.title, {
        dir: request.params.dir
      })
    case 'tag':
      return tagSession(request.params.sessionId, request.params.tag, { dir: request.params.dir })
    case 'delete':
      return deleteSession(request.params.sessionId, { dir: request.params.dir })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  const decoded = decodeLines(buffer + chunk)
  buffer = decoded.rest
  for (const message of decoded.messages) {
    const request = message as SessionRequest
    void handle(request)
      .then((result) => write({ id: request.id, result }))
      .catch((error: unknown) =>
        write({ id: request.id, error: error instanceof Error ? error.message : String(error) })
      )
  }
})
process.stdin.on('end', () => process.exit(0))

function write(response: SessionResponse): void {
  process.stdout.write(encodeLine(response))
}
