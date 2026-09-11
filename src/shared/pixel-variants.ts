/**
 * The five pixel characters from the landing page, as an agent's avatar.
 *
 * Shared because the config schema validates the id and the renderer draws
 * it; the grids themselves live in the renderer (`lib/pixel-desk.ts`), the
 * only place that draws them. The variant is the body's shape; the colour
 * is the agent's own, so any variant wears any colour.
 */
export const PIXEL_VARIANTS = [
  { id: 'clawd', label: 'Clawd' },
  { id: 'bit', label: 'Bit' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'block', label: 'Block' },
  { id: 'loop', label: 'Loop' }
] as const

export type PixelVariant = (typeof PIXEL_VARIANTS)[number]['id']

export const PIXEL_VARIANT_IDS = PIXEL_VARIANTS.map((v) => v.id) as [
  PixelVariant,
  ...PixelVariant[]
]

export const DEFAULT_PIXEL_VARIANT: PixelVariant = 'clawd'
