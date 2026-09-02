/**
 * The composer box has two layouts: one row (attach · text · send) while the
 * draft fits beside the buttons, and text-on-top with the buttons dropped to
 * a bottom row once it wraps.
 *
 * The decision cannot come from the textarea's own rendered height: its
 * width differs between the two layouts, so a draft that wraps in the
 * narrow row layout can fit one line at full width — reading the height
 * back would flip the layout, un-wrap the text, and oscillate forever.
 * Instead the draft is measured against the width the *row* layout offers,
 * whichever layout is currently on screen.
 */
export function wrapsAt(draft: string, width: number, measure: (line: string) => number): boolean {
  if (draft === '') return false
  const lines = draft.split('\n')
  if (lines.length > 1) return true
  return measure(lines[0]) > width
}

let canvas: HTMLCanvasElement | null = null

/** Text width in the given CSS font, off-screen. */
export function textMeasurer(font: string): (line: string) => number {
  canvas ??= document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => 0
  ctx.font = font
  return (line) => ctx.measureText(line).width
}
