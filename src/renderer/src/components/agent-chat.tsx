import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, GitBranch, ListPlus, Loader2, Pencil, Send, Square, X } from 'lucide-react'
import type { Agent } from '@shared/agent'
import { colorHexFor } from '@shared/agent-colors'
import {
  isTransient,
  type AgentRuntime,
  type PermissionRequest,
  type TranscriptEntry
} from '@shared/agent-runtime'
import type { ImageAttachment } from '@shared/attachments'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TranscriptMessage } from '@/components/transcript-message'
import { isRenderable } from '@/lib/transcript'
import { readImage, imageFiles } from '@/lib/attachments'
import { AttachmentChips } from '@/components/attachment-chips'
import { QueuedPrompts } from '@/components/queued-prompts'
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
  isCommandResult,
  pickAction,
  submitAction,
  type SlashCommandInfo
} from '@shared/slash-commands'
import { MAX_RETAINED_ENTRIES } from '@/hooks/use-sessions'
import { FilePicker } from '@/components/file-picker'
import { applyMention, filterFiles, mentionAt, mentionFor } from '@shared/file-mentions'
import { FilesChanged } from '@/components/files-changed'
import { filesChangedIn, isPrompt, turnBefore } from '@shared/files-changed'
import { trimOverlap } from '@shared/history-overlap'

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
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [caret, setCaret] = useState(0)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  // The mention an Escape press dismissed, so it stays closed until the
  // mention changes rather than reopening on every keystroke.
  const [dismissedMention, setDismissedMention] = useState<{
    start: number
    query: string
  } | null>(null)
  const dragDepth = useRef(0)
  const bottom = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const input = useRef<HTMLTextAreaElement>(null)

  const color = colorHexFor(agent.config.color)
  const busy = runtime.state === 'working' || runtime.state === 'starting'
  // Silent messages must be dropped before render, not inside the row: an
  // empty wrapper still reserves its contain-intrinsic-size placeholder.
  const visible = entries.filter(isRenderable)
  // History is re-read on every mount and the live list survives sidebar
  // switches, so after a live turn the two overlap; see trimOverlap.
  const historyVisible = trimOverlap(conversations.history, entries).filter(isRenderable)

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

  // The @ picker and the / picker are never open together: a slash in the
  // first column requires the draft to start with it, and mentionAt only
  // matches an @ at the start or after whitespace, so the two conditions
  // cannot both hold for the same draft.
  const mention = useMemo(() => mentionAt(draft, caret), [draft, caret])
  const fileMatches = useMemo(
    () => (mention ? filterFiles(workspaceFiles, mention.query) : []),
    [workspaceFiles, mention]
  )
  const filePickerOpen =
    mention !== null &&
    pickerQuery === null &&
    !(
      dismissedMention &&
      dismissedMention.start === mention.start &&
      dismissedMention.query === mention.query
    )

  useEffect(() => {
    if (!filePickerOpen) return
    void window.openRoom.listWorkspaceFiles(agent.config.id).then(setWorkspaceFiles)
  }, [filePickerOpen, agent.config.id])

  // Same pattern as the command picker's selection: keyed on the query so
  // typing resets it to the top without an effect firing after render.
  const [fileSelection, setFileSelection] = useState<{ query: string | null; index: number }>({
    query: mention?.query ?? null,
    index: 0
  })
  const fileSelected = fileSelection.query === (mention?.query ?? null) ? fileSelection.index : 0
  const setFileSelected = (update: number | ((i: number) => number)): void =>
    setFileSelection({
      query: mention?.query ?? null,
      index: typeof update === 'function' ? update(fileSelected) : update
    })

  const pickFile = (file: string): void => {
    if (!mention) return
    const next = applyMention(draft, mention, file)
    setDraft(next.draft)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  const attach = async (files: File[]): Promise<void> => {
    let count = images.length
    for (const file of files) {
      const result = await readImage(file, count)
      if (!result.ok) {
        setAttachError(result.reason)
        return
      }
      setImages((prev) => [...prev, result.image])
      count += 1
    }
    setAttachError(null)
  }

  const submit = async (override?: string): Promise<void> => {
    const text = (override ?? draft).trim()
    if (!text && images.length === 0) return

    // An unrecognised command is refused rather than sent as prose: the CLI
    // would answer "Unknown command" either way, but a typo that produces a
    // reply looks like it did something.
    const action = submitAction(text, runtime.commands)
    if (action.kind === 'reject') {
      setSendError(`No command "/${action.name}". Start with a space to send it as text.`)
      return
    }

    const sent = images
    setDraft('')
    setImages([])
    setSendError(null)
    const result = await window.openRoom.sendPrompt(agent.config.id, text, sent)
    if (!result.ok) {
      setSendError(result.message)
      setDraft(text)
      setImages(sent)
    }
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      // Only a drag carrying files is offered the overlay; a text selection
      // dragged across the pane is not something to attach.
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current -= 1
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void attach(imageFiles(e.dataTransfer.items))

        const others = Array.from(e.dataTransfer.files).filter((f) => !f.type.startsWith('image/'))
        const mentions = others
          .map((f) => window.openRoom.pathForFile(f))
          .filter((p) => p !== '')
          .map((p) => mentionFor(p, agent.config.workspacePath))
        if (mentions.length > 0) {
          setDraft(
            (prev) => (prev && !prev.endsWith(' ') ? `${prev} ` : prev) + mentions.join(' ') + ' '
          )
        }
      }}
    >
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
              {/* Which checkout the agent is editing. A worktree is named by
                  its branch with the path on hover; a fallback says why the
                  agent is in the workspace despite asking for a worktree,
                  because silently editing the wrong checkout is the failure
                  this exists to prevent. */}
              {runtime.isolation?.kind === 'worktree' && (
                <span className="flex items-center gap-1" title={runtime.isolation.path}>
                  · <GitBranch className="size-3" />
                  <span className="truncate font-mono">{runtime.isolation.branch}</span>
                </span>
              )}
              {runtime.isolation?.kind === 'fallback' && (
                <span className="text-amber-500" title={runtime.isolation.reason}>
                  · in workspace — {runtime.isolation.reason}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <McpHealth servers={runtime.mcpServers} />
          <ContextMeter usage={runtime.contextUsage} autoCompact={runtime.autoCompact} />
          <SessionControls
            config={agent.config}
            overrides={runtime.overrides}
            sessionPermissionMode={runtime.permissionMode}
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
            {historyVisible.map((entry, i) => {
              const message = entry.message as { type?: string }
              // Persisted history never carries the SDK's `result` message —
              // only Claude Code's own user/assistant transcript reaches
              // disk — so a turn boundary here has to be inferred from where
              // the next prompt starts, unlike the live list below.
              const isTurnEnd =
                message.type === 'assistant' &&
                (i === historyVisible.length - 1 || isPrompt(historyVisible[i + 1]))
              return (
                <Fragment key={entry.seq}>
                  <div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' }}>
                    <TranscriptMessage entry={entry} />
                  </div>
                  {isTurnEnd && (
                    <FilesChanged
                      agentId={agent.config.id}
                      cwd={runtime.cwd ?? agent.config.workspacePath}
                      files={filesChangedIn(
                        turnBefore(historyVisible, i + 1).map((e) => e.message)
                      )}
                    />
                  )}
                </Fragment>
              )
            })}
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
              It runs in {runtime.cwd ?? agent.config.workspacePath}
              {agent.config.worktrees && !runtime.cwd
                ? ' — each new conversation in its own git worktree'
                : ''}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((entry, i) => {
              const message = entry.message as { type?: string; subtype?: string }
              const isTurnEnd = message.type === 'result' && !isCommandResult(message)
              return (
                <Fragment key={entry.seq}>
                  {/* content-visibility lets the browser skip layout and paint
                      for rows scrolled out of view — most of the benefit of a
                      virtualised list without the dependency, given the
                      retained cap already bounds the DOM. */}
                  <div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' }}>
                    <TranscriptMessage entry={entry} />
                  </div>
                  {isTurnEnd && (
                    <FilesChanged
                      agentId={agent.config.id}
                      cwd={runtime.cwd ?? agent.config.workspacePath}
                      files={filesChangedIn(turnBefore(visible, i).map((e) => e.message))}
                    />
                  )}
                </Fragment>
              )
            })}
            {permissions.map((request) => (
              <PermissionPrompt key={request.id} request={request} agentName={agent.config.name} />
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-background/80 text-sm">
          Drop to attach
        </div>
      )}

      <div className="border-t border-border px-6 py-3">
        {sendError && (
          <p role="alert" className="pb-2 text-sm text-destructive">
            {sendError}
          </p>
        )}
        <QueuedPrompts agentId={agent.config.id} queued={runtime.queued} />
        <AttachmentChips
          images={images}
          onRemove={(i) => setImages((prev) => prev.filter((_, j) => j !== i))}
        />
        {attachError && <p className="pt-2 text-xs text-destructive">{attachError}</p>}
        <div className="relative flex items-end gap-2 pt-2">
          {pickerOpen && (
            <CommandPicker
              commands={matches}
              selected={selected}
              onPick={pick}
              onHover={setSelected}
            />
          )}
          {filePickerOpen && (
            <FilePicker
              files={fileMatches}
              selected={fileSelected}
              onPick={pickFile}
              onHover={setFileSelected}
            />
          )}
          <Textarea
            ref={input}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setCaret(e.currentTarget.selectionStart ?? 0)
            }}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onPaste={(e) => {
              const files = imageFiles(e.clipboardData?.items)
              if (files.length === 0) return
              e.preventDefault()
              void attach(files)
            }}
            onKeyDown={(e) => {
              if (filePickerOpen && fileMatches.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setFileSelected((i) => (i + 1) % fileMatches.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setFileSelected((i) => (i - 1 + fileMatches.length) % fileMatches.length)
                  return
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault()
                  pickFile(fileMatches[Math.min(fileSelected, fileMatches.length - 1)])
                  return
                }
              }
              if (filePickerOpen && e.key === 'Escape') {
                e.preventDefault()
                if (mention) setDismissedMention({ start: mention.start, query: mention.query })
                return
              }
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
          <Button
            onClick={() => void submit()}
            disabled={!draft.trim() && images.length === 0}
            size="icon"
            title={busy ? 'Queue for after this turn' : 'Send'}
          >
            {busy ? <ListPlus /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  )
}
