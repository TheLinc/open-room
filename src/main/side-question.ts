import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { Agent } from '@shared/agent'
import { buildChildEnv } from './agent-errors'
import { bundledClaudePath } from './claude-binary'
import { MAX_SPOKEN_CHARS } from './condense'

/**
 * A side question: answered now, from the conversation's context, and kept
 * out of it.
 *
 * The CLI's own `/btw` does this in the terminal, but it is a terminal-UI
 * command dispatched as a control request and cannot be passed through the
 * streaming input the way `/compact` can, so this is built rather than
 * forwarded. Measured: a forked, non-persisted query against a live
 * conversation answered "what did I last ask you" correctly in 5.2 s and
 * wrote no session file.
 */

const ASIDE_INSTRUCTION = [
  'The user has asked a quick side question by voice while you may be busy with other work.',
  'Answer it directly, from what you know of this conversation and workspace, in one or two',
  'plain spoken sentences for text-to-speech: no markdown, no lists, no code, no file paths.',
  'Do not start or continue any task.'
].join(' ')

/**
 * The query for one side question.
 *
 * Forked so it reads the conversation without appending to it, unpersisted
 * so nothing lands on disk, tool-less and single-turn so it can only answer.
 * A pure function of its inputs so every one of those can be asserted on.
 */
export function sideQuestionOptions(
  agent: Agent,
  sessionId: string | null,
  cwd: string,
  claudeExecutable: string | null = bundledClaudePath()
): Options {
  return {
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: `${agent.context}\n\n${ASIDE_INSTRUCTION}`
    },
    settingSources: [],
    cwd,
    model: agent.config.model,
    ...(agent.config.fallbackModel ? { fallbackModel: agent.config.fallbackModel } : {}),
    tools: [],
    allowedTools: [],
    maxTurns: 1,
    persistSession: false,
    ...(sessionId ? { resume: sessionId, forkSession: true } : {}),
    env: buildChildEnv(),
    ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
    includePartialMessages: false
  }
}

/**
 * The answer as it will be spoken.
 *
 * The instruction asks for plain prose, but a model can still hand back a
 * list or a paragraph; this flattens markup and keeps the leading sentences
 * that fit in a spoken line rather than reading a page aloud. The full text
 * is shown in the pane.
 */
export function speakableAnswer(answer: string): string {
  const flat = answer
    .replace(/[`*_#>]/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (flat.length <= MAX_SPOKEN_CHARS) return flat

  const sentences = flat.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [flat]
  let spoken = ''
  for (const sentence of sentences) {
    const next = (spoken + sentence).trim()
    if (next.length > MAX_SPOKEN_CHARS) break
    spoken = next
  }
  return spoken || flat.slice(0, MAX_SPOKEN_CHARS).trim()
}

export type SideQuestionDeps = {
  /** The conversation to ask about, and where it runs (null: the workspace). */
  conversationFor: (agentId: string) => { sessionId: string | null; cwd: string | null }
  /** Speaks the answer, or notifies when the agent has no voice. */
  say: (agentId: string, text: string) => void
  /** Records the exchange on the runtime so the pane can show it. */
  onAside: (agentId: string, aside: { question: string; answer: string | null }) => void
  claudeExecutable?: string | null
}

export type SideQuestionResult = { ok: true; answer: string } | { ok: false; message: string }

export class SideQuestions {
  constructor(private readonly deps: SideQuestionDeps) {}

  async ask(agent: Agent, question: string): Promise<SideQuestionResult> {
    const id = agent.config.id
    if (agent.config.wsl) {
      return { ok: false, message: 'Side questions are not available for WSL agents yet' }
    }
    const conversation = this.deps.conversationFor(id)
    const sessionId = conversation.sessionId
    const cwd = conversation.cwd ?? agent.config.workspacePath
    this.deps.onAside(id, { question, answer: null })

    let answer = ''
    try {
      for await (const message of query({
        prompt: question,
        options: sideQuestionOptions(agent, sessionId, cwd, this.deps.claudeExecutable)
      })) {
        if (message.type === 'result') {
          if (message.subtype !== 'success') {
            const message_ = 'The side question could not be answered'
            this.deps.onAside(id, { question, answer: message_ })
            return { ok: false, message: message_ }
          }
          answer = message.result.trim()
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The side question failed'
      this.deps.onAside(id, { question, answer: message })
      return { ok: false, message }
    }

    if (!answer) {
      this.deps.onAside(id, { question, answer: 'No answer came back' })
      return { ok: false, message: 'No answer came back' }
    }

    this.deps.onAside(id, { question, answer })
    this.deps.say(id, speakableAnswer(answer))
    return { ok: true, answer }
  }
}
