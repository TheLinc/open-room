import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { modelAccessFrom, type ModelAccess } from '@shared/model-access'
import { buildChildEnv } from './agent-errors'
import { bundledClaudePath } from './claude-binary'

export type { ModelAccess }

/**
 * Asks the bundled CLI which models the signed-in account can pick.
 *
 * `supportedModels()` is a control request on a live session, and the CLI
 * only sends its init once a first message has arrived — a query whose
 * generator never yields sits there forever (measured). A local slash
 * command is the cheapest first message there is: `/context` runs inside
 * the CLI with no model turn, so the whole probe is one process spawn.
 * Measured: 2.2 s from spawn to the model list, zero tokens.
 *
 * It runs after the login check says signed-in, and again on each recheck.
 * Anything that goes wrong is `unknown`, which allows every model: a probe
 * that failed must never lock a model the account does have.
 */

/** The slice of `query()` the probe uses, so a test can hand in a fake. */
export type ProbeQuery = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
}) => AsyncIterable<{ type: string; subtype?: string }> & {
  supportedModels(): Promise<{ value: string; resolvedModel?: string }[]>
  close(): void
}

const PROBE_TIMEOUT_MS = 15_000

async function* firstMessage(): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: '/context' },
    parent_tool_use_id: null,
    session_id: ''
  }
  // Streaming input: the generator stays open until the session is closed.
  await new Promise<never>(() => {})
}

export async function probeModelAccess(deps: {
  query: ProbeQuery
  binary: string | null
  timeoutMs?: number
}): Promise<ModelAccess> {
  if (!deps.binary) return { state: 'unknown' }
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS

  let session: ReturnType<ProbeQuery> | null = null
  const run = async (): Promise<ModelAccess> => {
    session = deps.query({
      prompt: firstMessage(),
      options: {
        settingSources: [],
        allowedTools: [],
        tools: [],
        persistSession: false,
        env: buildChildEnv(),
        pathToClaudeCodeExecutable: deps.binary
      }
    })
    for await (const message of session) {
      if (message.type === 'system' && message.subtype === 'init') {
        return modelAccessFrom(await session.supportedModels())
      }
    }
    return { state: 'unknown' }
  }

  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<ModelAccess>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'unknown' }), timeoutMs)
  })

  try {
    return await Promise.race([run(), timeout])
  } catch {
    return { state: 'unknown' }
  } finally {
    if (timer) clearTimeout(timer)
    try {
      ;(session as ReturnType<ProbeQuery> | null)?.close()
    } catch {
      // Already gone; nothing to release.
    }
  }
}

/** The real thing, on the bundled binary. */
export function checkModelAccess(): Promise<ModelAccess> {
  return probeModelAccess({ query: query as unknown as ProbeQuery, binary: bundledClaudePath() })
}
