import { describe, expect, it } from 'vitest'
import { overlayPosition, parseSavedPosition } from './overlay-position'

const size = { width: 460, height: 340 }
const fallback = { x: 730, y: 676 }
const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }

describe('overlayPosition', () => {
  it('uses the default until the pill has been moved', () => {
    expect(overlayPosition(null, size, [primary], fallback)).toEqual(fallback)
  })

  it('goes back where it was left', () => {
    expect(overlayPosition({ x: 100, y: 50 }, size, [primary], fallback)).toEqual({ x: 100, y: 50 })
  })

  it('may be left on another monitor', () => {
    const saved = { x: 3000, y: 900 }
    expect(overlayPosition(saved, size, [primary, right], fallback)).toEqual(saved)
  })

  it('falls back when the monitor it was left on is gone', () => {
    expect(overlayPosition({ x: 3000, y: 900 }, size, [primary], fallback)).toEqual(fallback)
  })

  it('judges by the content at the bottom, not the transparent window', () => {
    // The window's top edge is above the screen, but the pill is on it.
    expect(overlayPosition({ x: 100, y: -200 }, size, [primary], fallback)).toEqual({
      x: 100,
      y: -200
    })
    // The window starts on screen, but the pill would be below the bottom.
    expect(overlayPosition({ x: 100, y: 900 }, size, [primary], fallback)).toEqual(fallback)
  })
})

describe('parseSavedPosition', () => {
  it('reads a position and rounds it', () => {
    expect(parseSavedPosition({ x: 10.4, y: 20.6 })).toEqual({ x: 10, y: 21 })
  })

  it('refuses anything that is not two numbers', () => {
    expect(parseSavedPosition(null)).toBeNull()
    expect(parseSavedPosition({ x: '10', y: 20 })).toBeNull()
    expect(parseSavedPosition({ x: Number.NaN, y: 20 })).toBeNull()
  })
})
