import type { PixelVariant } from '@shared/pixel-variants'
import { DESK_HEIGHT, EMPTY_DESK, VARIANT_GRIDS, deskRects, gridWidth } from '@/lib/pixel-desk'

/**
 * The landing page's desk, in the app.
 *
 * With a `variant` and a `color` it is that character at its desk in the
 * agent's identity colour, the way the site draws the crew. Without a
 * variant it is the empty desk: monitor off, seat waiting. Crisp edges and
 * a viewBox in cells, so it scales to any width without blurring. Every
 * variant is 29 cells tall; widths differ by a few cells, which is why the
 * caller sizes by height.
 */
export function PixelDesk({
  variant,
  color,
  className
}: {
  variant?: PixelVariant
  /** The body's colour as hex. Ignored for the empty desk. */
  color?: string
  className?: string
}): React.JSX.Element {
  const rows = variant ? VARIANT_GRIDS[variant] : EMPTY_DESK
  const rects = deskRects(rows, {
    body: color ?? 'currentColor',
    // A lit screen in a pale tint; the empty desk's screen is off.
    screen: variant ? '#e8f4f4' : 'currentColor'
  })
  return (
    <svg
      viewBox={`0 0 ${gridWidth(rows)} ${DESK_HEIGHT}`}
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
          // The empty desk's dark screen is the text colour at low opacity,
          // so it sits quietly in either theme.
          opacity={r.fill === 'currentColor' ? 0.28 : 1}
        />
      ))}
    </svg>
  )
}
