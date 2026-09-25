import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { IDLE_RECORDER, keyDown, keyUp } from '@/lib/chord-recorder'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * A shortcut field you press rather than type.
 *
 * Typing an accelerator by hand cannot work: Ctrl and Shift produce no
 * character, so a text input records only the letter and yields a bare `a` —
 * which Electron registers happily and which then swallows that key in every
 * application on the machine.
 *
 * While recording, keys are read on the window in the capture phase, ahead
 * of everything else. The dialog around this field closes on Escape through
 * a document-level listener that runs before any handler on the field
 * itself, so a React `stopPropagation` here came too late and Escape closed
 * the whole dialog instead of cancelling the recording.
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
  const [display, setDisplay] = useState('')
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!recording) return
    let recorder = IDLE_RECORDER
    // The app's own global shortcuts would otherwise take a combination that
    // is already bound before this window sees it.
    window.openRoom.suspendHotkeys(true)

    const down = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      // Escape leaves the field alone rather than clearing it: it is the
      // universal "never mind", and it must never reach the dialog.
      if (event.code === 'Escape') {
        setRecording(false)
        return
      }
      recorder = keyDown(recorder, event)
      setDisplay(recorder.display)
    }

    const up = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const result = keyUp(recorder, event)
      recorder = result.recorder
      if (result.commit) {
        onChangeRef.current(result.commit)
        setRecording(false)
      } else if (recorder.pressed.length === 0) {
        setDisplay('')
      }
    }

    // Alt+Space chords never reach the page; main catches them instead.
    const offReserved = window.openRoom.onHotkeyRecorded((accelerator) => {
      onChangeRef.current(accelerator)
      setRecording(false)
    })

    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      offReserved()
      window.openRoom.suspendHotkeys(false)
      setDisplay('')
    }
  }, [recording])

  return (
    <div className="flex items-center gap-2">
      <button
        id={id}
        type="button"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
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
          display ? (
            <span className="font-mono text-xs text-foreground">{display}</span>
          ) : (
            <span className="animate-pulse">Press a shortcut, then let go…</span>
          )
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
