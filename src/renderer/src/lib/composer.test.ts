import { describe, expect, it } from 'vitest'
import { wrapsAt } from './composer'

const perChar = (line: string): number => line.length * 8

describe('wrapsAt', () => {
  it('stays on one row while the draft fits beside the buttons', () => {
    expect(wrapsAt('hello', 100, perChar)).toBe(false)
  })

  it('wraps once the measured text passes the row width', () => {
    expect(wrapsAt('hello world, this runs long', 100, perChar)).toBe(true)
  })

  it('treats a manual newline as wrapped however short it is', () => {
    expect(wrapsAt('a\nb', 1000, perChar)).toBe(true)
  })

  it('never wraps an empty draft, whatever the width', () => {
    expect(wrapsAt('', 0, perChar)).toBe(false)
  })
})
