import { parseUnifiedDiff, type DiffLine } from '@shared/unified-diff'
import type { FileDiffResult } from '@shared/ipc'
import { cn } from '@/lib/utils'

/**
 * A read-only rendering of `git diff` for one file.
 *
 * Draws what git printed, line for line, with the old and new line numbers
 * the parser worked out. No accept or revert — that is the editor's job, and
 * the "Open in editor" link beside the file is how you get there. Height is
 * bounded so a large change scrolls inside the row rather than taking over
 * the transcript.
 */

const BASE_LABEL: Record<'head' | 'branch-base', string> = {
  head: 'vs HEAD — uncommitted changes in the workspace',
  'branch-base': 'vs the branch base — everything this conversation changed, committed or not'
}

function lineClass(kind: DiffLine['kind']): string {
  switch (kind) {
    case 'add':
      return 'bg-emerald-500/10 text-emerald-300'
    case 'del':
      return 'bg-red-500/10 text-red-300'
    case 'meta':
      return 'text-muted-foreground italic'
    default:
      return 'text-foreground/80'
  }
}

const MARK: Record<DiffLine['kind'], string> = { add: '+', del: '-', context: ' ', meta: '\\' }

export function DiffView({ result }: { result: FileDiffResult }): React.JSX.Element {
  if (!result.ok) {
    return <p className="px-2 py-1.5 text-xs text-destructive">{result.message}</p>
  }
  if (result.tooLarge) {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        The diff is too large to show here. Open the file in your editor instead.
      </p>
    )
  }
  if (result.binary) {
    return <p className="px-2 py-1.5 text-xs text-muted-foreground">Binary file changed.</p>
  }
  if (result.empty) {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        No difference from the base right now — the change may have been reverted or committed back.
      </p>
    )
  }

  const { files } = parseUnifiedDiff(result.diff)

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 text-[11px] text-muted-foreground">{BASE_LABEL[result.base]}</p>
      <div className="max-h-80 overflow-auto rounded border border-border/60 bg-background/60">
        <table className="w-full border-collapse font-mono text-[11px] leading-5">
          <tbody>
            {files.flatMap((file, fi) =>
              file.hunks.flatMap((hunk, hi) => [
                <tr key={`h-${fi}-${hi}`} className="bg-sky-500/10 text-sky-300">
                  <td className="w-10 select-none px-2 text-right text-muted-foreground" />
                  <td className="w-10 select-none px-2 text-right text-muted-foreground" />
                  <td className="whitespace-pre px-2" colSpan={2}>
                    {hunk.header}
                  </td>
                </tr>,
                ...hunk.lines.map((line, li) => (
                  <tr key={`l-${fi}-${hi}-${li}`} className={cn(lineClass(line.kind))}>
                    <td className="w-10 select-none px-2 text-right text-muted-foreground/70">
                      {line.oldNo ?? ''}
                    </td>
                    <td className="w-10 select-none px-2 text-right text-muted-foreground/70">
                      {line.newNo ?? ''}
                    </td>
                    <td className="w-4 select-none pl-2">{MARK[line.kind]}</td>
                    <td className="whitespace-pre-wrap break-all pr-2">{line.text}</td>
                  </tr>
                ))
              ])
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
