import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  files: string[]
  selected: number
  onPick: (file: string) => void
  onHover: (index: number) => void
}

/** Workspace files matching the `@query` in the draft. */
export function FilePicker({ files, selected, onPick, onHover }: Props): React.JSX.Element {
  return (
    <div
      role="listbox"
      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover p-1 shadow-md"
    >
      {files.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching files</p>
      )}
      {files.map((file, i) => (
        <button
          key={file}
          role="option"
          aria-selected={i === selected}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs',
            i === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          )}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(file)}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{file}</span>
        </button>
      ))}
    </div>
  )
}
