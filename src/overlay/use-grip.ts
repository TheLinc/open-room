import { useEffect, useState } from 'react'

/** How long the pointer rests on the overlay before the grip appears. */
export const GRIP_DELAY_MS = 3000

/**
 * True once the pointer has rested on the overlay for `GRIP_DELAY_MS`, and
 * false again when it leaves. Delayed so a glance or a click on the pill
 * never shows a handle; only a deliberate rest does.
 */
export function useGripVisible(hovered: boolean): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(hovered), hovered ? GRIP_DELAY_MS : 0)
    return () => clearTimeout(timer)
  }, [hovered])
  // Main makes the window focusable while the grip shows: see `setGrip`.
  useEffect(() => window.overlay.reportGrip(visible), [visible])
  return visible
}
