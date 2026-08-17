import { z } from 'zod'
import {
  AGENT_COLOR_IDS,
  agentNameSchema,
  EFFORT_LEVELS,
  MODEL_IDS,
  mcpServerSchema,
  slugifyAgentName,
  type Agent
} from '@shared/agent'

/**
 * The editor works on a flat shape rather than `AgentConfig` directly.
 *
 * Two parts of the config resist direct binding: `tts` is a discriminated
 * union (so a disabled agent has no `voice` field to bind a control to), and
 * `mcpServers` is edited as raw JSON text. Flattening here keeps the form
 * components straightforward and confines the conversion to one tested file.
 */

/**
 * How a single tool is handled. This is the honest three-state model —
 * `allowedTools` alone would imply that anything unlisted is blocked, which
 * is false and would be dangerous to show a user.
 */
export type ToolPermission = 'ask' | 'allow' | 'deny'

export const TOOL_PERMISSION_LABELS: Record<ToolPermission, string> = {
  ask: 'Ask every time',
  allow: 'Always allow',
  deny: 'Never allow'
}

const OPTIONAL_SELECT = '' as const

export const agentFormSchema = z
  .object({
    name: agentNameSchema,
    color: z.enum(AGENT_COLOR_IDS),
    workspacePath: z.string().min(1, 'Choose a workspace folder'),
    model: z.enum(MODEL_IDS),
    effort: z.union([z.enum(EFFORT_LEVELS), z.literal(OPTIONAL_SELECT)]),
    fallbackModel: z.union([z.enum(MODEL_IDS), z.literal(OPTIONAL_SELECT)]),
    permissionMode: z.enum(['default', 'plan']),
    toolPermissions: z.record(z.string(), z.enum(['ask', 'allow', 'deny'])),
    persistSession: z.boolean(),
    hotkey: z.string(),
    mcpServersJson: z
      .string()
      .refine((text) => parseMcpServers(text).ok, { message: 'Not valid MCP server JSON' }),
    context: z.string(),
    notificationsEnabled: z.boolean(),
    ttsEnabled: z.boolean(),
    voiceProvider: z.enum(['system', 'kokoro']),
    voiceId: z.string(),
    rate: z.number().min(0.5).max(2)
  })
  // A speaking agent with no voice would fail validation in main with an
  // unhelpful message, so catch it here where the field can be highlighted.
  .superRefine((values, ctx) => {
    // System voices may be left unset, meaning the platform default. A Kokoro
    // voice names a specific speaker, so it cannot be blank.
    if (values.ttsEnabled && values.voiceProvider === 'kokoro' && !values.voiceId.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['voiceId'],
        message: 'Choose a voice, or turn off “Speak aloud”'
      })
    }
  })

export type AgentFormValues = z.infer<typeof agentFormSchema>

/**
 * Parses the MCP JSON editor's contents. Returns a result rather than
 * throwing so the form can show the reason inline while the user types.
 */
export function parseMcpServers(
  text: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: {} }

  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Invalid JSON' }
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, message: 'Expected an object mapping server names to configs' }
  }

  const parsed = z.record(z.string(), mcpServerSchema).safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, message: `${issue.path.join('.') || 'config'}: ${issue.message}` }
  }

  return { ok: true, value: parsed.data }
}

export function toolPermissionOf(
  tool: string,
  allowedTools: string[],
  disallowedTools: string[]
): ToolPermission {
  // Deny wins: if a tool somehow appears in both lists, the safer reading is
  // the restrictive one.
  if (disallowedTools.includes(tool)) return 'deny'
  if (allowedTools.includes(tool)) return 'allow'
  return 'ask'
}

export function toFormValues(agent: Agent, tools: readonly string[]): AgentFormValues {
  const { config } = agent

  const toolPermissions: Record<string, ToolPermission> = {}
  for (const tool of tools) {
    toolPermissions[tool] = toolPermissionOf(tool, config.allowedTools, config.disallowedTools)
  }

  return {
    name: config.name,
    color: config.color,
    workspacePath: config.workspacePath,
    model: config.model,
    effort: config.effort ?? OPTIONAL_SELECT,
    fallbackModel: config.fallbackModel ?? OPTIONAL_SELECT,
    permissionMode: config.permissionMode,
    toolPermissions,
    persistSession: config.persistSession,
    hotkey: config.hotkey ?? '',
    mcpServersJson: Object.keys(config.mcpServers).length
      ? JSON.stringify(config.mcpServers, null, 2)
      : '',
    context: agent.context,
    notificationsEnabled: config.notifications,
    ttsEnabled: config.tts.enabled,
    voiceProvider: config.tts.enabled ? config.tts.voice.provider : 'system',
    voiceId: config.tts.enabled ? config.tts.voice.id : '',
    rate: config.tts.enabled ? config.tts.rate : 1
  }
}

/**
 * Builds the persisted shape from form values.
 *
 * `id` is passed in rather than derived, because it must stay fixed across a
 * rename — it is the directory name, and changing it would orphan the agent's
 * files and its conversation history.
 */
export function toAgent(values: AgentFormValues, id?: string): Agent {
  const allowedTools: string[] = []
  const disallowedTools: string[] = []

  for (const [tool, permission] of Object.entries(values.toolPermissions)) {
    if (permission === 'allow') allowedTools.push(tool)
    if (permission === 'deny') disallowedTools.push(tool)
  }

  const mcp = parseMcpServers(values.mcpServersJson)

  return {
    config: {
      id: id ?? slugifyAgentName(values.name),
      name: values.name.trim(),
      color: values.color,
      model: values.model,
      ...(values.effort ? { effort: values.effort } : {}),
      ...(values.fallbackModel ? { fallbackModel: values.fallbackModel } : {}),
      workspacePath: values.workspacePath,
      mcpServers: (mcp.ok ? mcp.value : {}) as Record<string, never>,
      permissionMode: values.permissionMode,
      allowedTools,
      disallowedTools,
      persistSession: values.persistSession,
      notifications: values.notificationsEnabled,
      ...(values.hotkey.trim() ? { hotkey: values.hotkey.trim() } : {}),
      tts: values.ttsEnabled
        ? {
            enabled: true as const,
            voice: { provider: values.voiceProvider, id: values.voiceId },
            rate: values.rate
          }
        : { enabled: false as const }
    },
    context: values.context
  }
}
