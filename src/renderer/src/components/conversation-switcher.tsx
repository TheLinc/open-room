import { useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Pencil,
  Trash2
} from 'lucide-react'
import { describeDeletion, partitionArchived } from '@shared/archive'
import { describeLastActive, type Conversation } from '@shared/conversation'
import type { GuardedAction } from '@/lib/switch-guard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  conversations: Conversation[]
  active: Conversation | null
  onSelect: (sessionId: string) => void
  onNew: () => void
  onRename: (sessionId: string, title: string) => void
  onDelete: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onRestore: (sessionId: string) => void
  /** Days an archived conversation is kept; 0 means until deleted by hand. */
  archiveRetentionDays: number
  /**
   * Set while leaving the active conversation would stop a running turn:
   * the copy for a confirm shown in the menu before the action runs. Null
   * when the agent is idle and the action can go ahead on the click.
   */
  confirmBeforeLeaving: ((action: GuardedAction) => { line: string; confirm: string }) | null
}

/**
 * Picks which conversation the agent continues.
 *
 * New conversations are only ever created here, by an explicit click. There
 * is no idle timer and no per-launch reset: surprise amnesia would undermine
 * the persona the rest of the app presents, and the agent's WORKLOG.md is
 * what makes a deliberate reset cheap.
 *
 * Archived conversations sit under a collapsed group at the bottom rather
 * than vanishing: a list that silently shrinks reads as data loss, and the
 * countdown on each row is what makes the retention window trustworthy.
 *
 * Leaving the active conversation ends the agent's session, and a running
 * turn with it. While that is so, the actions that leave it (select
 * another, new, archive or delete the active one) show a confirm at the top
 * of the menu instead of running on the click. Rename and restore stop
 * nothing and never ask.
 */
export function ConversationSwitcher({
  conversations,
  active,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onArchive,
  onRestore,
  archiveRetentionDays,
  confirmBeforeLeaving
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // An action held back by the confirm, with the click that would run it.
  const [pending, setPending] = useState<{ action: GuardedAction; run: () => void } | null>(null)
  const close = (): void => {
    setOpen(false)
    setPending(null)
  }
  /** Runs now while the agent is idle; otherwise holds the action for the confirm. */
  const guarded = (action: GuardedAction, run: () => void): void => {
    if (confirmBeforeLeaving) setPending({ action, run })
    else run()
  }
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // The clock the countdowns are read against, taken when the menu opens: a
  // list that sits open for an hour is off by an hour, which is fine, while
  // reading the clock during render is not.
  const [now, setNow] = useState(() => Date.now())

  const { active: live, archived } = partitionArchived(conversations)

  const commitRename = (sessionId: string): void => {
    const title = draft.trim()
    if (title) onRename(sessionId, title)
    setRenaming(null)
  }

  return (
    <div className="relative min-w-0">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setNow(Date.now())
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        className="max-w-full justify-start gap-1.5 font-normal sm:max-w-[22rem]"
      >
        <span className="truncate">{active?.title ?? 'New conversation'}</span>
        {active?.archivedAt !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">(archived)</span>
        )}
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </Button>

      {open && (
        <>
          {/* Click-away layer, so the menu closes without a focus trap. */}
          <div className="fixed inset-0 z-40" onClick={close} />

          <div
            className="absolute top-full left-0 z-50 mt-1 flex max-h-96 w-96 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
            onKeyDown={(e) => {
              // Esc backs out one step: the confirm first, then the menu. The
              // confirm's button takes focus when it appears, so the key
              // lands here without a focus trap.
              if (e.key !== 'Escape') return
              e.stopPropagation()
              if (pending) setPending(null)
              else close()
            }}
          >
            {pending && confirmBeforeLeaving && (
              <div
                role="alertdialog"
                className="border-b border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm"
              >
                <p>{confirmBeforeLeaving(pending.action).line}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    autoFocus
                    onClick={() => {
                      pending.run()
                      close()
                    }}
                  >
                    {confirmBeforeLeaving(pending.action).confirm}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                guarded('new', () => {
                  onNew()
                  close()
                })
              }
              className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm hover:bg-muted"
            >
              <MessageSquarePlus className="size-4 shrink-0 text-muted-foreground" />
              New conversation
            </button>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {conversations.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted-foreground">No conversations yet.</p>
              )}

              {live.map((conversation) => {
                const isActive = conversation.sessionId === active?.sessionId

                if (renaming === conversation.sessionId) {
                  return (
                    <div key={conversation.sessionId} className="flex gap-1.5 p-2">
                      <Input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(conversation.sessionId)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="h-8"
                      />
                      <Button size="sm" onClick={() => commitRename(conversation.sessionId)}>
                        <Check />
                      </Button>
                    </div>
                  )
                }

                return (
                  <div
                    key={conversation.sessionId}
                    className={cn(
                      'group flex items-center gap-2 px-3 py-2 text-sm',
                      isActive ? 'bg-muted' : 'hover:bg-muted/50'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        // Re-selecting the active conversation changes nothing
                        // and stops nothing, so it never asks.
                        if (isActive) return close()
                        guarded('select', () => {
                          onSelect(conversation.sessionId)
                          close()
                        })
                      }}
                      className="flex min-w-0 flex-1 flex-col items-start text-left"
                    >
                      <span className="w-full truncate">{conversation.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {describeLastActive(conversation.lastModified)}
                      </span>
                    </button>

                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Rename conversation"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() => {
                        setDraft(conversation.title)
                        setRenaming(conversation.sessionId)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Archive conversation"
                      title={
                        archiveRetentionDays === 0
                          ? 'Archive. Kept until you delete it.'
                          : `Archive. Deleted after ${archiveRetentionDays} days.`
                      }
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() =>
                        isActive
                          ? guarded('archive', () => onArchive(conversation.sessionId))
                          : onArchive(conversation.sessionId)
                      }
                    >
                      <Archive />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Delete conversation"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() =>
                        isActive
                          ? guarded('delete', () => onDelete(conversation.sessionId))
                          : onDelete(conversation.sessionId)
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )
              })}

              {archived.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    aria-expanded={showArchived}
                    className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50"
                  >
                    {showArchived ? (
                      <ChevronDown className="size-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" />
                    )}
                    Archived ({archived.length})
                  </button>

                  {showArchived &&
                    archived.map((conversation) => (
                      <div
                        key={conversation.sessionId}
                        className={cn(
                          'group flex items-center gap-2 px-3 py-2 text-sm',
                          conversation.sessionId === active?.sessionId
                            ? 'bg-muted'
                            : 'hover:bg-muted/50'
                        )}
                      >
                        <div className="flex min-w-0 flex-1 flex-col items-start text-left text-muted-foreground">
                          <span className="w-full truncate">{conversation.title}</span>
                          <span className="text-xs">
                            {describeDeletion(
                              { archivedAt: conversation.archivedAt ?? now },
                              archiveRetentionDays,
                              now
                            )}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => onRestore(conversation.sessionId)}
                        >
                          <ArchiveRestore />
                          Restore
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Delete conversation"
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() => onDelete(conversation.sessionId)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
