import { useState } from 'react'
import { X } from 'lucide-react'
import { acceleratorFromEvent } from '@shared/accelerator'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * A shortcut field you press rather than type.
 *
 * Typing an accelerator by hand cannot work: Ctrl and Shift produce no
 * character, so a text input records only the letter and yields a bare `a` —
 * which Electron registers happily and which then swallows that key in every
 * application on the machine.
 */
export function HotkeyInput({
  value,
  onChange,
  id,
  placeholder = 'Click, then press a shortcut'
}: {
  value: string
  onChange: (accelerator: string) => void
  id?: string
  placeholder?: string
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()

    // Escape leaves the field alone rather than clearing it — it is the
    // universal "never mind", and it is also what cancels a live recording.
    if (event.code === 'Escape') {
      setRecording(false)
      return
    }

    // Null means only modifiers are down so far. Keep waiting: the user is
    // still assembling the chord.
    const accelerator = acceleratorFromEvent(event)
    if (accelerator === null) return

    onChange(accelerator)
    setRecording(false)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        id={id}
        type="button"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={recording ? onKeyDown : undefined}
        aria-label={recording ? 'Press a shortcut' : `Shortcut: ${value || 'none'}`}
        className={cn(
          'flex h-9 flex-1 items-center rounded-md border px-3 text-left text-sm transition-colors',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          recording
            ? 'border-primary bg-primary/5 text-muted-foreground'
            : 'border-input bg-transparent hover:bg-muted/40'
        )}
      >
        {recording ? (
          <span className="animate-pulse">Press a shortcut…</span>
        ) : value ? (
          <span className="font-mono text-xs">{value}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>

      {value && !recording && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Clear shortcut"
          onClick={() => onChange('')}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
