import { useCallback, useRef } from 'react'

/**
 * The static-backdrop dialog pattern: clicks outside a form dialog do not
 * dismiss it, they pulse it.
 *
 * An outside click on a dialog full of typing is almost never an intent to
 * discard the typing — it is a mis-click, or an attempt to see behind the
 * dialog — and treating it as "close" threw away half-edited agent config in
 * the field. A confirmation was tried first and read as clutter; ignoring
 * the click entirely is what form dialogs conventionally do (Bootstrap's
 * "static backdrop"). The pulse is the feedback that the dialog wants an
 * explicit answer: Esc, Cancel, the X and Save all still work, and all of
 * them are deliberate gestures rather than a stray click.
 *
 * Spread the returned props onto a `DialogContent`.
 */
export function useStaticDialog(): {
  ref: React.RefObject<HTMLDivElement | null>
  onInteractOutside: (event: Event) => void
} {
  const ref = useRef<HTMLDivElement | null>(null)

  const onInteractOutside = useCallback((event: Event) => {
    event.preventDefault()

    const el = ref.current
    if (!el) return
    // Restart the animation even when one is mid-flight, so every blocked
    // click answers with a pulse rather than only the first.
    el.classList.remove('dialog-attention')
    void el.offsetWidth
    el.classList.add('dialog-attention')
  }, [])

  return { ref, onInteractOutside }
}
