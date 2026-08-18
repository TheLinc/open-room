import { useEffect, useState } from 'react'
import { EMPTY_HIT_BOX } from '@shared/voice-input'

/**
 * Reports the visible content's box to main, and reads back whether the
 * cursor is inside it.
 *
 * This is the overlay's only source of hover. The window is click-through and
 * non-focusable, so it receives no mouse messages on Windows and `:hover`,
 * `mouseenter` and `mouseleave` never fire in it — main hit-tests the real
 * cursor against the box reported here instead.
 *
 * @param interactive whether clicks should land on this content.
 * @returns a ref for the element to measure, and whether the cursor is on it.
 */
export function useHitBox(interactive: boolean): {
  ref: (element: HTMLElement | null) => void
  hovered: boolean
} {
  const [hovered, setHovered] = useState(false)

  // The measured element is state rather than a ref: it changes when the
  // content does — the cluster giving way to the roster — and the observer
  // has to follow it.
  const [node, setNode] = useState<HTMLElement | null>(null)

  useEffect(() => window.overlay.onPointer(setHovered), [])

  useEffect(() => {
    if (!node) {
      window.overlay.reportHitBox(EMPTY_HIT_BOX)
      return
    }

    const report = (): void => {
      const rect = node.getBoundingClientRect()
      window.overlay.reportHitBox({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        interactive
      })
    }

    // Observed rather than reported once: the box changes whenever the content
    // resizes — a pip appearing, a transcript arriving — and a stale box means
    // hover stops working somewhere that still looks hoverable.
    const observer = new ResizeObserver(report)
    observer.observe(node)
    report()

    return () => observer.disconnect()
  }, [node, interactive])

  return { ref: setNode, hovered }
}
