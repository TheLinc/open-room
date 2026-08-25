/**
 * Slash commands as Open Room exposes them.
 *
 * The CLI executes any `/name` sent through the streaming input generator
 * itself — measured on SDK 0.3.233: `/usage`, `/compact` and `/context` all
 * ran locally with `num_turns: 0`, and an unknown command came back as
 * "Unknown command: /x" without a model turn. So execution is a pass-through;
 * what this module owns is which commands are offered, how a draft is read,
 * and how their output is told apart from the model's.
 */

/** The subset of the SDK's `SlashCommand` the picker needs. */
export type SlashCommandInfo = {
  name: string
  description: string
  argumentHint: string
}

export type ParsedCommand = { name: string; args: string }

/**
 * Session commands worth a place in the picker. Listed rather than derived:
 * the CLI reports 47 and perhaps six matter in a day.
 */
const SESSION_COMMANDS = ['clear', 'compact', 'context', 'usage', 'rename', 'autocompact']

/**
 * Built-ins that belong to the terminal or to configuration the app already
 * owns. `model` and `effort` are here because `SessionControls` is the honest
 * UI for them — a header control that shows the current value beats a command
 * whose echo has to be filtered out of the transcript.
 */
const HIDDEN_COMMANDS = new Set([
  'model',
  'effort',
  'init',
  'config',
  'mcp',
  'heapdump',
  'fast',
  'agents',
  'import',
  'insights',
  'recap',
  'goal',
  'ultrareview',
  'usage-credits',
  'extra-usage',
  'reload-skills',
  'auto-mode-setup',
  'list-agents',
  'team-onboarding',
  'workflow-launch-exec'
])

const isSessionCommand = (name: string): boolean => SESSION_COMMANDS.includes(name)

/**
 * Reads a draft as a command. Only a slash in the first column counts, so a
 * leading space is the escape hatch for literal text, `//` is never a
 * command, and a path like `/usr/bin/env` is prose.
 */
export function parseCommand(draft: string): ParsedCommand | null {
  const match = /^\/([a-z0-9][\w-]*)(?:\s+([\s\S]*))?$/i.exec(draft)
  if (!match) return null
  return { name: match[1], args: (match[2] ?? '').trim() }
}

/**
 * The commands the picker offers, session commands first, then skills.
 *
 * Anything not on the hidden list and not a `__internal` or `design-*`
 * command is assumed to be a skill and kept — a user's own commands should
 * appear without this file learning their names.
 */
export function visibleCommands(
  all: SlashCommandInfo[],
  terminalBound: string[]
): SlashCommandInfo[] {
  const terminal = new Set(terminalBound)
  const shown = all.filter(
    (c) =>
      !HIDDEN_COMMANDS.has(c.name) &&
      !terminal.has(c.name) &&
      !c.name.startsWith('__') &&
      !c.name.startsWith('design')
  )
  const byName = (a: SlashCommandInfo, b: SlashCommandInfo): number => a.name.localeCompare(b.name)
  return [
    ...shown.filter((c) => isSessionCommand(c.name)).sort(byName),
    ...shown.filter((c) => !isSessionCommand(c.name)).sort(byName)
  ]
}

/** Prefix matches first, then substring matches, each in list order. */
export function filterCommands(list: SlashCommandInfo[], query: string): SlashCommandInfo[] {
  const q = query.toLowerCase()
  if (!q) return list
  const prefix = list.filter((c) => c.name.toLowerCase().startsWith(q))
  const within = list.filter(
    (c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)
  )
  return [...prefix, ...within]
}

/**
 * Whether an SDK message is local command output rather than the model.
 *
 * The CLI stamps those with `model: '<synthetic>'`. Measured, not assumed:
 * `/usage` and an unknown command both produced an assistant message with
 * exactly that model and zero usage.
 */
export function isSyntheticAssistant(message: unknown): boolean {
  const m = message as { type?: string; message?: { model?: string } } | null
  return m?.type === 'assistant' && m.message?.model === '<synthetic>'
}

/**
 * Whether a result message closes a local command rather than a model turn.
 *
 * The distinction matters twice in the supervisor: such a result carries
 * all-zero usage that would otherwise overwrite the running totals, and its
 * output must not be read aloud by the silence fallback — nobody wants the
 * `/context` table spoken.
 */
export function isCommandResult(message: unknown): boolean {
  const m = message as { type?: string; num_turns?: number; duration_api_ms?: number } | null
  return m?.type === 'result' && m.num_turns === 0 && (m.duration_api_ms ?? 0) === 0
}

export type SubmitAction = { kind: 'send' } | { kind: 'reject'; name: string }

/**
 * Whether a draft should go to the agent.
 *
 * An unknown command is refused rather than sent: today it would reach the
 * CLI, which answers "Unknown command" locally — harmless, but a typo that
 * looks like it did something. Before the list has loaded there is nothing
 * to judge against, so everything is sent and the CLI has the last word.
 */
export function submitAction(draft: string, known: SlashCommandInfo[]): SubmitAction {
  const parsed = parseCommand(draft)
  if (!parsed || known.length === 0) return { kind: 'send' }
  if (known.some((c) => c.name === parsed.name)) return { kind: 'send' }
  return { kind: 'reject', name: parsed.name }
}

export type PickAction = { kind: 'fill'; draft: string } | { kind: 'run'; text: string }

/**
 * What choosing a command in the picker does. One that takes arguments is
 * filled in for the user to finish; one that does not is run on the spot.
 */
export function pickAction(command: SlashCommandInfo): PickAction {
  return command.argumentHint
    ? { kind: 'fill', draft: `/${command.name} ` }
    : { kind: 'run', text: `/${command.name}` }
}

export type CommandListState = {
  /** True once the list has been requested for this session. */
  loaded: boolean
  /** Commands the init message marked as bound to a terminal. */
  terminal: string[]
}

export type CommandListAction =
  { kind: 'fetch' } | { kind: 'replace'; commands: SlashCommandInfo[] }

/**
 * How one SDK message moves the command list along.
 *
 * The init message names the commands but not their descriptions; those
 * come from `supportedCommands()`, a control round trip. Init is re-sent
 * every turn, so the fetch happens once. A `commands_changed` push carries
 * the full list and is meant to replace it.
 */
export function commandListUpdate(
  state: CommandListState,
  message: unknown
): { state: CommandListState; action: CommandListAction | null } {
  const m = message as {
    type?: string
    subtype?: string
    terminal_slash_commands?: string[]
    commands?: SlashCommandInfo[]
  } | null
  if (m?.type !== 'system') return { state, action: null }

  if (m.subtype === 'init') {
    const terminal = m.terminal_slash_commands ?? []
    return state.loaded
      ? { state: { loaded: true, terminal }, action: null }
      : { state: { loaded: true, terminal }, action: { kind: 'fetch' } }
  }

  if (m.subtype === 'commands_changed') {
    return {
      state,
      action: { kind: 'replace', commands: visibleCommands(m.commands ?? [], state.terminal) }
    }
  }

  return { state, action: null }
}
