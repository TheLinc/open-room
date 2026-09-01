import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { Agent } from '@shared/agent'
import { effectiveSettings, type SessionOverrides } from '@shared/session-overrides'
import { buildChildEnv } from './agent-errors'
import { SPEAK_TOOL_NAME, VOICE_SERVER_NAME } from './speak-tool'

/**
 * The options one agent's `query()` runs with.
 *
 * Pure and separate from `AgentSupervisor` so it can be asserted on directly.
 * Several of the choices here are load-bearing in ways nothing else checks —
 * an agent whose tool access silently widens, or whose API key stops being
 * stripped, still works perfectly and bills the wrong account.
 */
export function agentQueryOptions(
  agent: Agent,
  resumeSessionId: string | null,
  /** Open Room's in-process `speak` server, built per turn. */
  voiceServer: NonNullable<Options['mcpServers']>[string],
  canUseTool: Options['canUseTool'],
  /**
   * Session overrides for model, effort and permission mode.
   *
   * Applied here as well as through the live `Query` control methods, so an
   * override set before the first prompt survives the session actually
   * starting rather than taking effect one turn late.
   */
  overrides: SessionOverrides = {},
  /**
   * The SDK's bundled `claude`, resolved outside the asar. Null when the
   * platform package is missing, in which case the SDK is left to its own
   * resolution and reports the failure itself.
   */
  claudeExecutable: string | null = null,
  /**
   * Where the session runs. The workspace by default; a conversation's git
   * worktree when the agent isolates conversations — see `WorktreeManager`.
   * Passed in rather than derived here because the decision needs git and
   * the filesystem, and this function is kept pure so it can be asserted on.
   */
  cwd: string = agent.config.workspacePath,
  /**
   * Replaces how the SDK starts the CLI, for agents whose `claude` runs
   * inside a WSL distro. The SDK's protocol over stdio is unchanged.
   */
  spawnClaudeCodeProcess: Options['spawnClaudeCodeProcess'] = undefined
): Options {
  const { config } = agent
  const settings = effectiveSettings(config, overrides)

  return {
    systemPrompt: { type: 'preset', preset: 'claude_code', append: agent.context },
    /**
     * No filesystem settings. An agent gets the MCP servers its own config
     * names, and nothing else.
     *
     * Omitting this loads user, project and local settings, which in practice
     * means the machine decides what an agent can do: measured on one
     * developer's install, an agent configured with three tools was handed 73
     * and eight MCP servers, four of them from `enabledPlugins` in
     * `~/.claude/settings.json`. That breaks the promise the editor makes —
     * that an agent's tool access is what its config says — and makes the
     * same config behave differently on someone else's machine, which for an
     * app people install from source is a real divergence.
     *
     * Note what this does *not* isolate: `~/.claude.json`, claude.ai
     * connectors, managed policy settings and the workspace's own memory
     * files are read regardless, and need their own mechanisms.
     */
    settingSources: [],
    cwd,
    model: settings.model,
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(config.fallbackModel ? { fallbackModel: config.fallbackModel } : {}),
    mcpServers: {
      ...(config.mcpServers as Options['mcpServers']),
      // In-process, so the spoken line never leaves the app.
      [VOICE_SERVER_NAME]: voiceServer
    },
    permissionMode: settings.permissionMode,
    // Speaking is always allowed: it is Open Room's own in-process tool and
    // asking permission for it would stall every turn behind a dialog.
    allowedTools: [...config.allowedTools, SPEAK_TOOL_NAME],
    disallowedTools: config.disallowedTools,
    persistSession: config.persistSession,
    // `resume` opens an existing conversation; the streaming generator drives
    // it from there. An ephemeral session cannot be resumed, so the two must
    // never be paired.
    ...(resumeSessionId && config.persistSession ? { resume: resumeSessionId } : {}),
    // No `title` is set deliberately: it lands in both customTitle and
    // summary, so every conversation would carry the same name and the
    // switcher would be useless. The SDK's own summary is per-conversation,
    // and the agent is identified by tag instead.
    // Replaces process.env rather than merging, so it is built explicitly
    // with ANTHROPIC_API_KEY removed.
    env: buildChildEnv(),
    ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
    ...(spawnClaudeCodeProcess ? { spawnClaudeCodeProcess } : {}),
    includePartialMessages: false,
    canUseTool
  }
}
