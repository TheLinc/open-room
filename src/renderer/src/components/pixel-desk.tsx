import type { PixelVariant } from '@shared/pixel-variants'
import {
  DESK_SEAT,
  DESK_SEAT_DARK,
  DESK_WOOD,
  EMPTY_DESK,
  VARIANT_GRIDS,
  deskLayers,
  deskRects,
  gridWidth,
  outputLines
} from '@/lib/pixel-desk'

/**
 * The landing page's desk, in the app.
 *
 * With a `variant` and a `color` it is that character at its desk in the
 * agent's identity colour, the way the site draws the crew. Without a
 * variant it is the empty desk: monitor off, seat waiting. Crisp edges and
 * a viewBox in cells, so it scales to any width without blurring. Every
 * seated variant is 29 cells tall and the empty desk is shorter; widths
 * differ by a few cells, which is why the caller sizes by height.
 *
 * `status` is the site's: while `working` the screen goes dark in the
 * agent's hue with lines of output appearing and a cursor blinking, and
 * the two hands take turns rising to type (`.desk-hand` in `main.css`).
 * `done` keeps the lit screen with every line shown and the hands still.
 */
export type DeskStatus = 'idle' | 'working' | 'done'

const FURNITURE: Record<string, string> = { k: DESK_WOOD, t: DESK_SEAT, s: DESK_SEAT_DARK }

function Runs({
  runs,
  fill
}: {
  runs: { x: number; y: number; w: number }[]
  fill: string
}): React.JSX.Element {
  return (
    <>
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={fill} />
      ))}
    </>
  )
}

export function PixelDesk({
  variant,
  color,
  status = 'idle',
  className
}: {
  variant?: PixelVariant
  /** The body's colour as hex. Ignored for the empty desk. */
  color?: string
  status?: DeskStatus
  className?: string
}): React.JSX.Element {
  if (!variant) {
    const rects = deskRects(EMPTY_DESK, { body: 'currentColor', screen: 'currentColor' })
    return (
      <svg
        viewBox={`0 0 ${gridWidth(EMPTY_DESK)} ${EMPTY_DESK.length}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
        className={className}
      >
        {rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={1}
            fill={r.fill}
            // The empty desk's dark screen is the text colour at low
            // opacity, so it sits quietly in either theme.
            opacity={r.fill === 'currentColor' ? 0.28 : 1}
          />
        ))}
      </svg>
    )
  }

  const rows = VARIANT_GRIDS[variant]
  const layers = deskLayers(rows)
  const body = color ?? 'currentColor'
  // A working screen goes dark in the agent's hue so the head in front of
  // it stays a clear silhouette and the output reads as light on a monitor.
  const lit = status !== 'idle'
  const screenFill = lit ? `color-mix(in srgb, ${body} 30%, #1c1913)` : '#e8f4f4'
  const lines = lit ? outputLines(layers.screen) : []
  const cursorY = layers.screen.y + 1 + lines.length * 2

  return (
    <svg
      viewBox={`0 0 ${gridWidth(rows)} ${rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-status={status}
    >
      <rect
        x={layers.screen.x}
        y={layers.screen.y}
        width={layers.screen.w}
        height={layers.screen.h}
        fill={screenFill}
        style={{ transition: 'fill 300ms steps(1)' }}
      />
      <g className="desk-output">
        {lines.map((l, i) => (
          <rect
            key={i}
            x={layers.screen.x + 1}
            y={l.y}
            width={l.w}
            height={1}
            fill="#e8f4f4"
            style={{ '--i': i } as React.CSSProperties}
          />
        ))}
        {status === 'working' && cursorY < layers.screen.y + layers.screen.h ? (
          <rect
            className="desk-cursor"
            x={layers.screen.x + 1}
            y={cursorY}
            width={2}
            height={1}
            fill="#e8f4f4"
          />
        ) : null}
      </g>
      {layers.furniture.map((r, i) => (
        <rect key={`f${i}`} x={r.x} y={r.y} width={r.w} height={1} fill={FURNITURE[r.ch]} />
      ))}
      <Runs runs={layers.body} fill={body} />
      <g className="desk-hand desk-hand-l">
        <Runs runs={layers.handL} fill={body} />
      </g>
      <g className="desk-hand desk-hand-r">
        <Runs runs={layers.handR} fill={body} />
      </g>
    </svg>
  )
}
