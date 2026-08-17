import { randomUUID } from 'node:crypto'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Agent } from '@shared/agent'
import { SPEAK_CALLS_PER_TURN, SPEECH_PRIORITIES, type SpeechPriority } from '@shared/speech'
import type { SpeechBus } from './speech-bus'

/** MCP server name; the SDK namespaces tools as `mcp__<server>__<tool>`. */
export const VOICE_SERVER_NAME = 'openroom-voice'

/**
 * Fully-qualified tool name, auto-approved so the agent is never made to ask
 * permission to speak. It runs in-process, touches no file, network, or
 * shell, and its entire purpose is talking to the user — prompting for it
 * stalls the turn behind a dialog asking "may I say a sentence aloud?".
 */
export const SPEAK_TOOL_NAME = `mcp__${VOICE_SERVER_NAME}__speak`

/**
 * Per-turn speech budget for one agent.
 *
 * Tracked here rather than in the prompt because prompt guidance shapes
 * behaviour but cannot enforce it, and an agent narrating every step is as
 * bad a failure as one that stays silent.
 */
export type TurnSpeechState = {
  calls: number
  spoke: boolean
}

export function newTurnSpeechState(): TurnSpeechState {
  return { calls: 0, spoke: false }
}

export type SpeechSlot = { allowed: true } | { allowed: false; reason: string }

/**
 * Claims one of this turn's speech slots.
 *
 * Overflow is refused *to the model* rather than dropped silently, so it can
 * adjust and save its remaining budget for the result, instead of repeating
 * into a void it cannot observe.
 */
export function claimSpeechSlot(turn: TurnSpeechState): SpeechSlot {
  if (turn.calls >= SPEAK_CALLS_PER_TURN) {
    return {
      allowed: false,
      reason: `Not spoken: already used ${SPEAK_CALLS_PER_TURN} speech slots this turn. Save it for the final result.`
    }
  }

  turn.calls += 1
  turn.spoke = true
  return { allowed: true }
}

/**
 * Builds the in-process MCP server carrying the `speak` tool.
 *
 * Speech content comes from this tool, never from the transcript. Tool inputs
 * are never summarised, so the line the agent wrote is the line that gets
 * spoken — and the call renders in chat as an ordinary `tool_use` block,
 * which is exactly what Claude Code would show anyway.
 *
 * The tool returns immediately rather than awaiting playback: the agent
 * should carry on working while it is being heard, and blocking here would
 * stall a turn behind an audio device.
 */
export function createSpeakServer(
  agent: Agent,
  bus: SpeechBus,
  turn: TurnSpeechState
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: VOICE_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'speak',
        [
          'Say one short sentence out loud to the user.',
          'Use it for questions you need answered, blockers, and completed results.',
          'Do not use it to narrate routine steps — the user can read the transcript.',
          'Plain prose only: no file paths, no code, no markdown.'
        ].join(' '),
        {
          message: z.string().min(1).describe('One sentence of plain prose to say aloud.'),
          priority: z
            .enum(SPEECH_PRIORITIES)
            .describe(
              'question: you need an answer to continue. blocker: you are stuck. ' +
                'done: a task finished. progress: an update mid-task.'
            )
        },
        async ({ message, priority }) => {
          const slot = claimSpeechSlot(turn)
          if (!slot.allowed) {
            return { content: [{ type: 'text' as const, text: slot.reason }] }
          }

          bus.enqueue({
            id: randomUUID(),
            agentId: agent.config.id,
            agentName: agent.config.name,
            text: message,
            priority: priority as SpeechPriority,
            queuedAt: Date.now()
          })

          return { content: [{ type: 'text' as const, text: 'Spoken.' }] }
        }
      )
    ]
  })
}
