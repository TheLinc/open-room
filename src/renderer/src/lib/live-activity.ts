import type { TranscriptEntry } from '@shared/agent-runtime'

/**
 * What the one row standing in for a live turn's activity says.
 *
 * T3 Code's pattern (`MessagesTimeline.logic.ts`, the `work-live` row): while
 * a turn runs, its tool calls collapse into a single row that names only the
 * latest call, in the present tense while it is pending and the past tense
 * once it has answered, so the row keeps a subject between calls instead of
 * flickering. Subagents are counted on the same row rather than nested,
 * and their own calls (marked `parent_tool_use_id`) never drive the label.
 * Skills get no summary in T3 either; here the Skill tool reads as
 * "Using skill x", which is the one place a skill shows up.
 *
 * Pure so the fold logic can call it on every render.
 */

type Block = {
  type?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
}

type ToolUse = { name: string; input: unknown }

const MAX_DETAIL = 60

function blocksOf(entry: TranscriptEntry): Block[] {
  const content = (entry.message as { message?: { content?: unknown } } | null)?.message?.content
  return Array.isArray(content) ? (content as Block[]) : []
}

function parentOf(entry: TranscriptEntry): string | null {
  const parent = (entry.message as { parent_tool_use_id?: unknown } | null)?.parent_tool_use_id
  return typeof parent === 'string' ? parent : null
}

function field(input: unknown, key: string): string | null {
  const value = (input as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

/** One line of detail: first line only, cut with an ellipsis past the cap. */
function clip(text: string): string {
  const line = text.split(/\r?\n/, 1)[0].trim()
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1)}…` : line
}

/** `mcp__server__tool` reads as the tool alone; the server is not the point. */
function shortToolName(name: string): string {
  const parts = name.split('__')
  return parts.length >= 3 && parts[0] === 'mcp' ? parts.slice(2).join('__') : name
}

/** A present/past verb pair, joined to a detail when the input carries one. */
function line(pending: boolean, present: string, past: string, detail: string | null): string {
  const verb = pending ? present : past
  return detail ? `${verb} ${clip(detail)}` : verb
}

export function describeToolUse(use: ToolUse, pending: boolean): string {
  const { name, input } = use
  switch (name) {
    case 'Bash': {
      const command = field(input, 'command')
      return command
        ? `${pending ? 'Running' : 'Ran'} \`${clip(command)}\``
        : line(pending, 'Running a command', 'Ran a command', null)
    }
    case 'Read':
      return line(pending, 'Reading', 'Read', field(input, 'file_path'))
    case 'Edit':
    case 'MultiEdit':
      return line(pending, 'Editing', 'Edited', field(input, 'file_path'))
    case 'NotebookEdit':
      return line(pending, 'Editing', 'Edited', field(input, 'notebook_path'))
    case 'Write':
      return line(pending, 'Writing', 'Wrote', field(input, 'file_path'))
    case 'Grep':
    case 'Glob':
      return line(pending, 'Searching for', 'Searched for', field(input, 'pattern'))
    case 'Skill':
      return line(pending, 'Using skill', 'Used skill', field(input, 'skill'))
    case 'Task':
    case 'Agent':
      return line(pending, 'Running subagent:', 'Ran subagent:', field(input, 'description'))
    case 'WebFetch':
      return line(pending, 'Fetching', 'Fetched', field(input, 'url'))
    case 'WebSearch':
      return line(pending, 'Searching the web for', 'Searched the web for', field(input, 'query'))
    default: {
      const short = shortToolName(name)
      if (short !== name) return line(pending, 'Calling', 'Called', short)
      return line(pending, 'Running', 'Ran', name)
    }
  }
}

/**
 * The label for a run of activity that prose has already followed: how
 * many calls it holds, since "3 steps" over a call and its result would
 * count one call twice. A run with no call at all was thinking.
 */
export function pastRunLabel(run: readonly TranscriptEntry[]): string {
  let calls = 0
  for (const entry of run) {
    if (parentOf(entry) !== null) continue
    for (const block of blocksOf(entry)) if (block.type === 'tool_use') calls += 1
  }
  if (calls === 0) return 'Thought'
  return `${calls} call${calls === 1 ? '' : 's'}`
}

function isSubagent(name: string): boolean {
  return name === 'Task' || name === 'Agent'
}

/**
 * The label for a run of activity entries within a live turn: the latest
 * top-level tool call, then how many subagents are still working.
 */
export function liveActivityLabel(run: readonly TranscriptEntry[]): string {
  const resolved = new Set<string>()
  for (const entry of run) {
    for (const block of blocksOf(entry)) {
      if (block.type === 'tool_result' && block.tool_use_id) resolved.add(block.tool_use_id)
    }
  }

  let latest: { use: ToolUse; id: string | undefined } | null = null
  let subagentsWorking = 0
  for (const entry of run) {
    if (parentOf(entry) !== null) continue
    for (const block of blocksOf(entry)) {
      if (block.type !== 'tool_use' || !block.name) continue
      latest = { use: { name: block.name, input: block.input }, id: block.id }
      if (isSubagent(block.name) && !(block.id && resolved.has(block.id))) subagentsWorking += 1
    }
  }

  if (!latest) return 'Thinking'
  const pending = !(latest.id && resolved.has(latest.id))
  const head = describeToolUse(latest.use, pending)
  if (subagentsWorking === 0) return head
  const noun = subagentsWorking === 1 ? 'subagent' : 'subagents'
  return `${head} · ${subagentsWorking} ${noun} working`
}
