import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Loader2, Pencil, Send, Square, X } from 'lucide-react'
import type { Agent } from '@shared/agent'
import { colorHexFor } from '@shared/agent-colors'
import {
  isTransient,
  type AgentRuntime,
  type PermissionRequest,
  type TranscriptEntry
} from '@shared/agent-runtime'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TranscriptMessage } from '@/components/transcript-message'
import { isRenderable } from '@/lib/transcript'
import { ContextMeter } from '@/components/context-meter'
import { McpHealth } from '@/components/mcp-health'
import { SessionControls } from '@/components/session-controls'
import { ConversationSwitcher } from '@/components/conversation-switcher'
import { describeLastActive } from '@shared/conversation'
import type { ConversationsApi } from '@/hooks/use-conversations'
import { PermissionPrompt } from '@/components/permission-prompt'
import { CommandPicker } from '@/components/command-picker'
import {
  filterCommands,
  pickAction,
  submitAction,
  type SlashCommandInfo
} from '@shared/slash-commands'
import { MAX_RETAINED_ENTRIES } from '@/hooks/use-sessions'

type Props = {
  agent: Agent
  runtime: AgentRuntime
  entries: TranscriptEntry[]
  truncated: boolean
  permissions: PermissionRequest[]
  conversations: ConversationsApi
  onEdit: () => void
}

const STATE_LABEL: Record<AgentRuntime['state'], string> = {
  idle: 'Not running',
  starting: 'Starting…',
  ready: 'Ready',
  working: 'Working',
  error: 'Needs attention'
}

export function AgentChat({
  agent,
  runtime,
  entries,
  truncated,
  permissions,
  conversations,
  onEdit
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const color = colorHexFor(agent.config.color)
  const busy = runtime.state === 'working' || runtime.state === 'starting'
  // Silent messages must be dropped before render, not inside the row: an
  // empty wrapper still reserves its contain-intrinsic-size placeholder.
  const visible = entries.filter(isRenderable)
  const historyVisible = conversations.history.filter(isRenderable)

  // Follow the tail only while the user is already at the bottom — yanking
  // them down mid-scroll while an agent streams is the classic chat-log
  // annoyance.
  useEffect(() => {
    if (pinned.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [entries, permissions, historyVisible.length])

  /**
   * Distance from the bottom at the moment older messages were requested.
   *
   * Prepending content grows `scrollHeight` above the viewport, so a fixed
   * `scrollTop` would jump the reader backwards by exactly the height of what
   * just loaded. Anchoring to the bottom instead keeps the same messages
   * under the cursor.
   */
  const anchorFromBottom = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || anchorFromBottom.current === null) return
    el.scrollTop = el.scrollHeight - anchorFromBottom.current
    anchorFromBottom.current = null
  }, [historyVisible.length])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80

    // Load the previous page before the reader actually reaches the top, so
    // the fetch usually lands before they get there.
    if (el.scrollTop < 200 && conversations.hasEarlier && !conversations.loadingEarlier) {
      anchorFromBottom.current = el.scrollHeight - el.scrollTop
      void conversations.loadEarlier()
    }
  }

  // The picker is open while the draft is a bare `/query` — a slash in the
  // first column and no whitespace yet. Once arguments start, it closes.
  const pickerQuery = /^\/(\S*)$/.exec(draft)?.[1] ?? null
  const matches = useMemo(
    () => (pickerQuery === null ? [] : filterCommands(runtime.commands, pickerQuery)),
    [runtime.commands, pickerQuery]
  )
  const pickerOpen = pickerQuery !== null && runtime.commands.length > 0
  // Selection is remembered against the query it was made for, so typing
  // resets it to the top without an effect firing after the render.
  const [selection, setSelection] = useState({ query: pickerQuery, index: 0 })
  const selected = selection.query === pickerQuery ? selection.index : 0
  const setSelected = (update: number | ((i: number) => number)): void =>
    setSelection({
      query: pickerQuery,
      index: typeof update === 'function' ? update(selected) : update
    })

  const pick = (command: SlashCommandInfo): void => {
    const action = pickAction(command)
    if (action.kind === 'fill') setDraft(action.draft)
    else void submit(action.text)
  }

  const submit = async (override?: string): Promise<void> => {
    const text = (override ?? draft).trim()
    if (!text) return

    // An unrecognised command is refused rather than sent as prose: the CLI
    // would answer "Unknown command" either way, but a typo that produces a
    // reply looks like it did something.
    const action = submitAction(text, runtime.commands)
    if (action.kind === 'reject') {
      setSendError(`No command "/${action.name}". Start with a space to send it as text.`)
      return
    }

    setDraft('')
    setSendError(null)
    const result = await window.openRoom.sendPrompt(agent.config.id, text)
    if (!result.ok) {
      setSendError(result.message)
      setDraft(text)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <h2 className="truncate text-base font-semibold tracking-tight">
                {agent.config.name}
              </h2>
              {agent.config.persistSession && (
                <ConversationSwitcher
                  conversations={conversations.conversations}
                  active={conversations.active}
                  onSelect={(id) => void conversations.select(id)}
                  onNew={() => void conversations.startNew()}
                  onRename={(id, title) => void conversations.rename(id, title)}
                  onDelete={(id) => void conversations.remove(id)}
                />
              )}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {busy && <Loader2 className="size-3 animate-spin" />}
              {STATE_LABEL[runtime.state]}
              {runtime.usage.numTurns > 0 && (
                <span>
                  · {runtime.usage.numTurns} turns · ${runtime.usage.totalCostUsd.toFixed(4)}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <McpHealth servers={runtime.mcpServers} />
          <ContextMeter usage={runtime.contextUsage} />
          <SessionControls
            config={agent.config}
            overrides={runtime.overrides}
            onChange={(patch) => void window.openRoom.setOverrides(agent.config.id, patch)}
          />
          {runtime.state === 'working' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void window.openRoom.interruptAgent(agent.config.id)}
            >
              <X /> Interrupt
            </Button>
          )}
          {runtime.state !== 'idle' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void window.openRoom.stopAgent(agent.config.id)}
            >
              <Square /> Stop
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        </div>
      </header>

      {runtime.error && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2 border-b px-6 py-3 text-sm',
            isTransient(runtime.error.kind)
              ? 'border-amber-500/30 bg-amber-500/5 text-amber-500'
              : 'border-destructive/30 bg-destructive/5 text-destructive'
          )}
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span>{runtime.error.message}</span>
            {runtime.error.hint && (
              <span className="text-muted-foreground">{runtime.error.hint}</span>
            )}
          </div>
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {truncated && (
          <p className="pb-4 text-center text-xs text-muted-foreground">
            Showing the most recent {MAX_RETAINED_ENTRIES} messages. Earlier ones remain in the
            session transcript on disk.
          </p>
        )}

        {conversations.hasEarlier && (
          <div className="flex items-center justify-center gap-2 pb-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading earlier messages…
          </div>
        )}

        {historyVisible.length > 0 && (
          <div className="flex flex-col gap-3 pb-3">
            {historyVisible.map((entry) => (
              <div
                key={entry.seq}
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' }}
              >
                <TranscriptMessage entry={entry} />
              </div>
            ))}
          </div>
        )}

        {historyVisible.length > 0 && (
          <div className="flex items-center gap-3 py-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>
              Resumed
              {conversations.active
                ? ` · last active ${describeLastActive(conversations.active.lastModified)}`
                : ''}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}

        {visible.length === 0 && permissions.length === 0 && historyVisible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing yet. Ask {agent.config.name} to do something.
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              It runs in {agent.config.workspacePath}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((entry) => (
              // content-visibility lets the browser skip layout and paint for
              // rows scrolled out of view — most of the benefit of a
              // virtualised list without the dependency, given the retained
              // cap already bounds the DOM.
              <div
                key={entry.seq}
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' }}
              >
                <TranscriptMessage entry={entry} />
              </div>
            ))}
            {permissions.map((request) => (
              <PermissionPrompt key={request.id} request={request} agentName={agent.config.name} />
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <div className="border-t border-border px-6 py-3">
        {sendError && (
          <p role="alert" className="pb-2 text-sm text-destructive">
            {sendError}
          </p>
        )}
        <div className="relative flex items-end gap-2">
          {pickerOpen && (
            <CommandPicker
              commands={matches}
              selected={selected}
              onPick={pick}
              onHover={setSelected}
            />
          )}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (pickerOpen && matches.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelected((i) => (i + 1) % matches.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelected((i) => (i - 1 + matches.length) % matches.length)
                  return
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault()
                  pick(matches[Math.min(selected, matches.length - 1)])
                  return
                }
              }
              if (pickerOpen && e.key === 'Escape') {
                e.preventDefault()
                setDraft('')
                return
              }
              // Enter sends; Shift+Enter is a newline, matching every chat
              // input people already use.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder={`Ask ${agent.config.name} to do something…`}
            className="max-h-40 min-h-[44px] resize-none"
          />
          <Button onClick={() => void submit()} disabled={!draft.trim()} size="icon">
            <Send />
          </Button>
        </div>
      </div>
    </div>
  )
}
