/**
 * Where the overlay goes: where the user dragged it, as long as that is still
 * on a screen.
 *
 * The position is the window's top-left in screen coordinates, saved when a
 * drag ends and read at launch. It is checked against the displays every time
 * it is used, because displays come and go (a monitor sleeping, a laptop
 * undocked) and a pill placed on a screen that is no longer there is a pill
 * nobody can see. The saved value is kept even then, so the pill goes back to
 * that monitor when it returns.
 */

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

/**
 * How far above the window's bottom edge the content sits: the pill and the
 * HUD are anchored to the bottom, over the room left for their shadow. It is
 * the content that has to be on screen, not the transparent window around it.
 */
const CONTENT_FROM_BOTTOM = 70

export function overlayPosition(
  saved: Point | null,
  size: { width: number; height: number },
  workAreas: Rect[],
  fallback: Point
): Point {
  if (!saved) return fallback
  const anchor = {
    x: saved.x + size.width / 2,
    y: saved.y + size.height - CONTENT_FROM_BOTTOM
  }
  const onScreen = workAreas.some(
    (area) =>
      anchor.x >= area.x &&
      anchor.x <= area.x + area.width &&
      anchor.y >= area.y &&
      anchor.y <= area.y + area.height
  )
  return onScreen ? saved : fallback
}

/** A saved position read back from disk, or null for anything else. */
export function parseSavedPosition(raw: unknown): Point | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { x, y } = raw as { x?: unknown; y?: unknown }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x as number), y: Math.round(y as number) }
}
