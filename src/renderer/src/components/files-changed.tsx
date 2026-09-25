import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FilePlus, FilePen, Loader2 } from 'lucide-react'
import { displayPath, type ChangedFile } from '@shared/files-changed'
import type { FileDiffResult } from '@shared/ipc'
import type { FileStat } from '@shared/numstat'
import { DiffView } from '@/components/diff-view'

type Props = {
  agentId: string
  files: ChangedFile[]
  /** The conversation's checkout, so paths inside it are shown relative. */
  cwd: string
}

/**
 * The receipt under a finished turn: what it wrote, each path a link into
 * the user's editor, with a read-only diff a click away. Accept/reject per
 * hunk is the editor's job; this answers "what did it touch" and "what did
 * it do to it" and gets you there.
 *
 * The diff is fetched when a row is expanded, never for the whole list —
 * a turn can touch dozens of files, and most rows are never opened. It is
 * the file's current state against the conversation's base, which the view
 * labels, not a snapshot at the end of this turn.
 *
 * The lines added and removed are fetched for the whole list at once, one
 * `git diff --numstat` for the turn, so its size reads without opening
 * anything; they are the same comparison as the diff, and clicking them
 * opens it.
 */
export function FilesChanged({ agentId, files, cwd }: Props): React.JSX.Element | null {
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, FileDiffResult | 'loading' | undefined>>({})
  const [stats, setStats] = useState<Record<string, FileStat>>({})

  // Keyed by the paths rather than the array, which the parent rebuilds on
  // every render.
  const pathKey = JSON.stringify(files.map((file) => file.path))
  useEffect(() => {
    const paths = JSON.parse(pathKey) as string[]
    if (paths.length === 0) return
    let cancelled = false
    void window.openRoom.fileStats(agentId, paths).then((next) => {
      if (!cancelled) setStats(next)
    })
    return () => {
      cancelled = true
    }
  }, [agentId, pathKey])

  if (files.length === 0) return null

  const openInEditor = async (path: string): Promise<void> => {
    const result = await window.openRoom.openInEditor(agentId, path)
    setError(result.ok ? null : result.message)
  }

  const toggleDiff = async (path: string): Promise<void> => {
    if (open[path]) {
      setOpen((prev) => ({ ...prev, [path]: undefined }))
      return
    }
    setOpen((prev) => ({ ...prev, [path]: 'loading' }))
    const result = await window.openRoom.fileDiff(agentId, path)
    setOpen((prev) => (prev[path] === 'loading' ? { ...prev, [path]: result } : prev))
  }

  return (
    <details className="rounded border border-border/60 bg-muted/20 px-2 py-1.5" open>
      <summary className="cursor-pointer text-xs text-muted-foreground select-none">
        Files changed ({files.length})
      </summary>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {files.map((file) => {
          const state = open[file.path]
          return (
            <li key={file.path} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <button
                  type="button"
                  className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                  title={state ? 'Hide diff' : 'Show diff'}
                  aria-label={state ? 'Hide diff' : 'Show diff'}
                  aria-expanded={Boolean(state)}
                  onClick={() => void toggleDiff(file.path)}
                >
                  {state === 'loading' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : state ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                </button>
                {file.created ? (
                  <FilePlus className="size-3.5 shrink-0 text-emerald-500" aria-label="Created" />
                ) : (
                  <FilePen
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Edited"
                  />
                )}
                <button
                  className="truncate text-left hover:underline"
                  title={`Open in editor — ${file.path}`}
                  onClick={() => void openInEditor(file.path)}
                >
                  {displayPath(file.path, cwd)}
                </button>
                <LineCounts stat={stats[file.path]} onClick={() => void toggleDiff(file.path)} />
              </div>
              {state && state !== 'loading' && <DiffView result={state} />}
            </li>
          )
        })}
      </ul>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </details>
  )
}

/** `+12 −3` beside a path, the diff a click away. Nothing until the counts arrive. */
function LineCounts({
  stat,
  onClick
}: {
  stat: FileStat | undefined
  onClick: () => void
}): React.JSX.Element | null {
  if (!stat) return null
  return (
    <button
      type="button"
      title="Lines added and removed against the conversation's base. Click for the diff."
      className="ml-auto flex shrink-0 gap-1.5 rounded px-1 tabular-nums hover:bg-foreground/8"
      onClick={onClick}
    >
      {'binary' in stat ? (
        <span className="text-muted-foreground">binary</span>
      ) : (
        <>
          <span className="text-emerald-500">+{stat.added}</span>
          <span className="text-red-500">−{stat.removed}</span>
        </>
      )}
    </button>
  )
}
