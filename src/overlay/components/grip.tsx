/**
 * The handle the overlay is dragged by.
 *
 * The page runs the drag and main moves the window: the pointer is captured
 * on press, and every move sends its screen position. That press only
 * arrives because main makes the window focusable while the grip shows (see
 * `setGrip`); otherwise Windows swallows it. `app-region: drag` was tried
 * first and did nothing here, driven with a real cursor.
 */
export function DragGrip({ vertical = false }: { vertical?: boolean }): React.JSX.Element {
  return (
    <span
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        window.overlay.reportDrag('start', event.screenX, event.screenY)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          window.overlay.reportDrag('move', event.screenX, event.screenY)
        }
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        window.overlay.reportDrag('end')
      }}
      title="Drag to move"
      className="or-grip or-enter flex shrink-0 cursor-grab items-center justify-center rounded-md text-or-fg/45"
    >
      <svg
        aria-hidden
        width={vertical ? 8 : 14}
        height={vertical ? 14 : 8}
        viewBox={vertical ? '0 0 8 14' : '0 0 14 8'}
        fill="currentColor"
      >
        {[0, 1, 2].flatMap((i) =>
          [0, 1].map((j) =>
            vertical ? (
              <circle key={`${i}${j}`} cx={2 + j * 4} cy={2 + i * 5} r={1.3} />
            ) : (
              <circle key={`${i}${j}`} cx={2 + i * 5} cy={2 + j * 4} r={1.3} />
            )
          )
        )}
      </svg>
    </span>
  )
}
