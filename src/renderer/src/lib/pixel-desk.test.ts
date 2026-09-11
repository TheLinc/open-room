import { describe, expect, it } from 'vitest'
import { PIXEL_VARIANT_IDS } from '@shared/pixel-variants'
import {
  DESK_HEIGHT,
  DESK_WOOD,
  EMPTY_DESK,
  FRONT_GRIDS,
  VARIANT_GRIDS,
  deskRects,
  figureRects,
  gridWidth
} from './pixel-desk'

const desks = [
  ['empty', EMPTY_DESK] as const,
  ...PIXEL_VARIANT_IDS.map((id) => [id, VARIANT_GRIDS[id]] as const)
]
const figures = PIXEL_VARIANT_IDS.map((id) => [id, FRONT_GRIDS[id]] as const)

describe('the desk grids', () => {
  it.each(desks)('%s is a full rectangle of the shared height', (_, rows) => {
    expect(rows).toHaveLength(DESK_HEIGHT)
    const width = gridWidth(rows)
    for (const row of rows) expect(row).toHaveLength(width)
  })

  it.each(desks)('%s uses only the desk palette', (_, rows) => {
    expect(rows.join('')).toMatch(/^[.ktsXS]+$/)
  })

  it('leaves nobody at the empty desk, with a monitor standing on a painted desk', () => {
    expect(EMPTY_DESK.join('')).not.toContain('X')
    // The stand runs from the bezel down to the desk surface without a gap.
    const standRows = EMPTY_DESK.map((row) => row.slice(14, 16))
    expect(standRows.slice(9, 13).every((cells) => cells === 'kk')).toBe(true)
    expect(EMPTY_DESK[13].replaceAll('.', '')).toMatch(/^k+$/)
  })
})

describe('the front-facing grids', () => {
  it.each(figures)('%s is a full rectangle using only the figure palette', (_, rows) => {
    const width = gridWidth(rows)
    for (const row of rows) expect(row).toHaveLength(width)
    expect(rows.join('')).toMatch(/^[.XDW]+$/)
  })

  it.each(figures)('%s has eyes', (_, rows) => {
    expect(rows.join('')).toContain('W')
  })

  it('has a figure for every variant the config can name', () => {
    for (const id of PIXEL_VARIANT_IDS) expect(FRONT_GRIDS[id]).toBeDefined()
  })
})

describe('deskRects', () => {
  const rects = deskRects(VARIANT_GRIDS.clawd, { body: '#111', screen: '#eee' })

  it('covers every painted cell exactly once and no transparent one', () => {
    const rows = VARIANT_GRIDS.clawd
    const painted = new Set<string>()
    for (const r of rects) {
      for (let i = 0; i < r.w; i += 1) {
        const key = `${r.x + i},${r.y}`
        expect(painted.has(key)).toBe(false)
        painted.add(key)
        expect(rows[r.y][r.x + i]).not.toBe('.')
      }
    }
    expect(painted.size).toBe(rows.join('').replace(/\./g, '').length)
  })

  it('colours the body and screen as asked and the furniture as the site does', () => {
    const fills = new Set(rects.map((r) => r.fill))
    expect(fills.has('#111')).toBe(true)
    expect(fills.has('#eee')).toBe(true)
    expect(fills.has(DESK_WOOD)).toBe(true)
  })

  it('merges a run into one rect rather than a rect per cell', () => {
    // The desk top is one 14-cell run of wood.
    expect(rects[0]).toEqual({ x: 8, y: 0, w: 14, fill: DESK_WOOD })
  })
})

describe('figureRects', () => {
  it('maps the three figure colours and nothing else', () => {
    const rects = figureRects(FRONT_GRIDS.terminal, { body: 'b', shade: 'd', eye: 'w' })
    expect(new Set(rects.map((r) => r.fill))).toEqual(new Set(['b', 'd', 'w']))
  })
})
