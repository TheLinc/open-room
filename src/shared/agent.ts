import { z } from 'zod'

/**
 * The agent domain model, shared by main (validation, persistence) and
 * renderer (form validation, types). Electron- and Node-free.
 *
 * Config lives at `~/.open-room/agents/<id>/config.json`, with the agent's
 * role context alongside it in `AGENT.md`.
 */

export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'Most capable. Best for hard, open-ended work.' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'Balanced speed and capability.' },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    hint: 'Fastest and cheapest. Good for narrow tasks.'
  },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'Previous-generation Opus.' }
] as const

export const MODEL_IDS = MODELS.map((m) => m.id) as [string, ...string[]]

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Identity colors. Deliberately high-contrast against each other — these
 * distinguish agents at a glance in the sidebar and in the listening overlay,
 * where the name may be too small to read quickly.
 */
export const AGENT_COLORS = [
  { id: 'amber', hex: '#f59e0b' },
  { id: 'emerald', hex: '#10b981' },
  { id: 'sky', hex: '#0ea5e9' },
  { id: 'violet', hex: '#8b5cf6' },
  { id: 'rose', hex: '#f43f5e' },
  { id: 'lime', hex: '#84cc16' },
  { id: 'cyan', hex: '#06b6d4' },
  { id: 'orange', hex: '#f97316' }
] as const

export const AGENT_COLOR_IDS = AGENT_COLORS.map((c) => c.id) as [string, ...string[]]

/**
 * Tools Claude Code exposes. Used to build the permission lists.
 * `allowedTools` auto-approves; `disallowedTools` hard-denies. Anything in
 * neither list prompts — that is the safe default and must stay the default.
 */
export const CLAUDE_CODE_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'Task',
  'TodoWrite'
] as const

/** MCP server shapes, kept loose so unfamiliar keys survive a round trip. */
const mcpStdioSchema = z.looseObject({
  type: z.literal('stdio').optional(),
  command: z.string().min(1, 'command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional()
})

const mcpRemoteSchema = z.looseObject({
  type: z.enum(['sse', 'http']),
  url: z.url('must be a valid URL'),
  headers: z.record(z.string(), z.string()).optional()
})

export const mcpServerSchema = z.union([mcpStdioSchema, mcpRemoteSchema])

export const voiceRefSchema = z.discriminatedUnion('provider', [
  // An empty system id means "whatever this machine's default voice is",
  // which travels between machines better than a named voice that may not
  // exist on the other one.
  z.object({ provider: z.literal('system'), id: z.string() }),
  // Kokoro is the neural backend: Apache-2.0 engine, weights and voices, the
  // same on every platform. Requires a one-time model download.
  z.object({ provider: z.literal('kokoro'), id: z.string().min(1) })
])

export const ttsSchema = z.discriminatedUnion('enabled', [
  z.object({
    enabled: z.literal(true),
    voice: voiceRefSchema,
    /** Maps to Piper's `length_scale`; 1 is the voice's natural rate. */
    rate: z.number().min(0.5).max(2)
  }),
  z.object({ enabled: z.literal(false) })
])

/**
 * Agent names are wake-word targets first and labels second, so they are
 * constrained to what a speech transcript can plausibly contain. The
 * separate `id` is the on-disk directory name.
 */
export const agentNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(32, 'Name must be 32 characters or fewer')
  .regex(
    /^[A-Za-z][A-Za-z0-9 '-]*$/,
    'Start with a letter; letters, numbers, spaces, hyphens and apostrophes only'
  )

export const agentConfigSchema = z.object({
  /** Slug derived from the name at creation. Stable across renames. */
  id: z.string().regex(/^[a-z0-9-]+$/, 'Invalid agent id'),
  name: agentNameSchema,
  color: z.enum(AGENT_COLOR_IDS),
  model: z.enum(MODEL_IDS),
  effort: z.enum(EFFORT_LEVELS).optional(),
  fallbackModel: z.enum(MODEL_IDS).optional(),
  workspacePath: z.string().min(1, 'Workspace path is required'),
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),

  // Permissions. These are not symmetric — see the note in CLAUDE.md.
  permissionMode: z.enum(['default', 'plan']).default('default'),
  allowedTools: z.array(z.string()).default([]),
  disallowedTools: z.array(z.string()).default([]),

  /** false = nothing written to disk, and no conversation history or resume. */
  persistSession: z.boolean().default(true),
  /** Optional per-agent push-to-talk binding, e.g. "CommandOrControl+Alt+1". */
  hotkey: z.string().optional(),
  tts: ttsSchema.default({ enabled: false })
})

export type AgentConfig = z.infer<typeof agentConfigSchema>
export type VoiceRef = z.infer<typeof voiceRefSchema>
export type McpServerConfig = z.infer<typeof mcpServerSchema>

/** An agent as the renderer sees it: config plus its role context. */
export type Agent = {
  config: AgentConfig
  /** Contents of AGENT.md. */
  context: string
}

/**
 * Turns a display name into a filesystem id. Lowercased deliberately:
 * Windows and macOS default to case-insensitive filesystems, so "Atlas" and
 * "atlas" would collide as directories. Uniqueness is enforced on the id.
 */
export function slugifyAgentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const DEFAULT_AGENT_CONTEXT = `# Role

Describe what this agent is responsible for. This file is appended to the
Claude Code system prompt, so write it as standing instructions.

## Speaking aloud

Call the \`speak\` tool when you need an answer from me, when you are blocked,
and when you finish a task. One sentence of plain prose — no file paths, no
code. Do not call it to narrate routine steps; I can read the transcript.

## Worklog

Keep a \`WORKLOG.md\` in the workspace. Append a short dated entry whenever you
finish a meaningful unit of work or make a decision worth remembering. Read it
at the start of a new conversation to recover where things stand.
`

export function createDefaultAgent(name: string, workspacePath: string, color: string): Agent {
  return {
    config: {
      id: slugifyAgentName(name),
      name: name.trim(),
      color,
      model: 'claude-sonnet-5',
      workspacePath,
      mcpServers: {},
      permissionMode: 'default',
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: [],
      persistSession: true,
      tts: { enabled: false }
    },
    context: DEFAULT_AGENT_CONTEXT
  }
}
