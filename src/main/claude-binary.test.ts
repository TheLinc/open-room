import { describe, expect, it } from 'vitest'
import { outsideAsar } from './claude-binary'

// Windows paths are built with String.raw so the backslashes survive: a test
// in this repo once passed for the wrong reason when they collapsed.
const packaged = String.raw`C:\App\resources\app.asar\node_modules\x\claude.exe`
const unpacked = String.raw`C:\App\resources\app.asar.unpacked\node_modules\x\claude.exe`

describe('outsideAsar', () => {
  it('rewrites a path inside the archive to its unpacked twin', () => {
    expect(outsideAsar(packaged)).toBe(unpacked)
    expect(outsideAsar('/Applications/Open Room.app/Contents/Resources/app.asar/x/claude')).toBe(
      '/Applications/Open Room.app/Contents/Resources/app.asar.unpacked/x/claude'
    )
  })

  it('leaves a path that is already unpacked, or not packaged at all, alone', () => {
    expect(outsideAsar(unpacked)).toBe(unpacked)
    const dev = String.raw`F:\repo\node_modules\x\claude.exe`
    expect(outsideAsar(dev)).toBe(dev)
  })
})
