import type { PixelVariant } from '@shared/pixel-variants'
import { FRONT_GRIDS, figureRects } from '@/lib/pixel-desk'

/**
 * One of the five characters facing forward, no desk: the editor's picker.
 *
 * The body is the agent's colour; the shade is that colour darkened with
 * `color-mix`, so Terminal's screen follows whatever colour is picked
 * without a second palette. Eyes are white in every theme, as on the site.
 */
export function PixelFigure({
  variant,
  color,
  className
}: {
  variant: PixelVariant
  /** The body's colour as hex. */
  color: string
  className?: string
}): React.JSX.Element {
  const rows = FRONT_GRIDS[variant]
  const rects = figureRects(rows, {
    body: color,
    shade: `color-mix(in srgb, ${color} 55%, #000)`,
    eye: '#ffffff'
  })
  return (
    <svg
      viewBox={`0 0 ${rows[0].length} ${rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}
