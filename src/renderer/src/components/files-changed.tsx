import { useState } from 'react'
import { FilePlus, FilePen } from 'lucide-react'
import type { ChangedFile } from '@shared/files-changed'

type Props = {
  agentId: string
  files: ChangedFile[]
}

/**
 * The receipt under a finished turn: what it wrote, each path a link into
 * the user's editor. Accept/reject per hunk is the editor's job; this only
 * answers "what did it touch" and gets you there.
 */
export function FilesChanged({ agentId, files }: Props): React.JSX.Element | null {
  const [error, setError] = useState<string | null>(null)

  if (files.length === 0) return null

  const open = async (path: string): Promise<void> => {
    const result = await window.openRoom.openInEditor(agentId, path)
    setError(result.ok ? null : result.message)
  }

  return (
    <details className="rounded border border-border/60 bg-muted/20 px-2 py-1.5" open>
      <summary className="cursor-pointer text-xs text-muted-foreground select-none">
        Files changed ({files.length})
      </summary>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {files.map((file) => (
          <li key={file.path} className="flex items-center gap-1.5 font-mono text-xs">
            {file.created ? (
              <FilePlus className="size-3.5 shrink-0 text-emerald-500" aria-label="Created" />
            ) : (
              <FilePen className="size-3.5 shrink-0 text-muted-foreground" aria-label="Edited" />
            )}
            <button
              className="truncate text-left hover:underline"
              title="Open in editor"
              onClick={() => void open(file.path)}
            >
              {file.path}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </details>
  )
}
