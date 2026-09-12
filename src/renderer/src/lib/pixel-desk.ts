import type { PixelVariant } from '@shared/pixel-variants'

/**
 * The landing page's desks, in the app.
 *
 * Every grid is traced from the site's crew row (`crew-sprites.ts` in the
 * open-room-site repo, generated from a keyframe still): a monitor on a
 * desk and a chair, seen from behind, with the agent's body in front of the
 * screen. The five variants differ in the body, which is the character;
 * the body takes whatever colour the caller gives it, so any variant can
 * wear any agent colour. Palette characters: `k` wood, `t` seat, `s` seat
 * shadow, `X` the body, `S` the screen, `.` transparent. Kept as text so
 * the pictures are reviewable in a diff, and turned into one rect per
 * horizontal run so the SVG stays small.
 *
 * The empty desk is drawn by hand from Clawd's furniture with what the body
 * hid filled in: the monitor's bottom bezel, a short stand, the desk
 * surface it stands on, and the chair in front, its back overlapping the
 * desk and the stand's base so the three read as one piece. It is shorter
 * than the seated grids; the first cuts left the surface unpainted (the
 * monitor floated) and then stacked everything without overlap (too tall).
 *
 * The front-facing figures are traced from the site's mascot sheet, an
 * AI-rendered JPEG: each character's pixel size was fitted by overlap
 * against the image (the coarsest grid within 1.5 points of the best),
 * cells sampled at their centres, and white cells not reachable from the
 * border read as eyes. Terminal's dark screen was hand-corrected to the
 * filled inner area the sheet shows. Extra palette characters: `D` a
 * darker shade of the body, `W` eye white.
 */

export const DESK_HEIGHT = 29

/** Nobody at the desk; the seat waits. */
export const EMPTY_DESK: readonly string[] = [
  '........kkkkkkkkkkkkkk........',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kkkkkkkkkkkkkkkk.......',
  '..............kk..............',
  '..............kk..............',
  '............kkkkkk............',
  '..kkkkkkkkkkttttttkkkkkkkkkk..',
  '..ksssssssskttttttkssssssssk..',
  '...k.......kttkkttk.......k...',
  '...k..........kk..........k...',
  '...k..........kk..........k...',
  '...k.......tttkkttt.......k...',
  '...k......kssskksssk......k...',
  '...k.......kkkkkkkk.......k...',
  '...k..........kk..........k...',
  '...k..........kk..........k...',
  '............kkkkkk............',
  '...........k......k...........'
]
/** Clawd at the desk, 30 cells wide. */
const CLAWD_DESK: readonly string[] = [
  '........kkkkkkkkkkkkkk........',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......kSSSSSSSSSSSSSSk.......',
  '.......XXXXXXXXXXXXXXXX.......',
  '.......XXXXXXXXXXXXXXXX.......',
  '.......XXXXXXXXXXXXXXXX.......',
  '.......XXXXXXXXXXXXXXXX.......',
  '.......XXXXXXXXXXXXXXXX.......',
  '.......XXXXXXXXXXXXXXXX.......',
  '.......XXXXXkkkkkkXXXXX.......',
  '.XX.XXXXXXXkttttttkXXXXXXX.XX.',
  '.XXXXXXXXXXkttttttkXXXXXXXXXX.',
  '..XXXXkXXXXkttkkttkXXXXkXXXX..',
  '..kssssXXXXkttkkttkXXXXssssk..',
  '...k...XXXXXXXkkXXXXXXX...k...',
  '...k.....X.X..kk..X.X.....k...',
  '...k.....X.X..kk..X.X.....k...',
  '...k.....X.tttkkttt.X.....k...',
  '...k......kssskksssk......k...',
  '...k.......kkkkkkkk.......k...',
  '...k..........kk..........k...',
  '...k..........kk..........k...',
  '............kkkkkk............',
  '...........k......k...........'
]
/** Bit at the desk, 27 cells wide. */
const BIT_DESK: readonly string[] = [
  '......kkXXXkkkkXXXXkk......',
  '.....kSSXSXSSSSSXSXSSk.....',
  '.....kSSXXXSSSSSXXXSSk.....',
  '.....kSSSXSSSSSSSXSSSk.....',
  '.....kSSSXSSSSSSSXSSSk.....',
  '.....kSXXXXXXXXXXXXSSk.....',
  '.....kSXXXXXXXXXXXXSSk.....',
  '.....kSXXXXXXXXXXXXSSk.....',
  '.....kSXXXXXXXXXXXXSSk.....',
  '.....kSXXXXXXXXXXXXSSk.....',
  '.....kSXXXXXXXXXXXXSSk.....',
  '.....kSXXXXXXXXXXXXSSk.....',
  '......kkkkXXXXXXXkkkkk.....',
  '..........XXXXXXt..........',
  '........SXXkkkkkXXt........',
  '....SkXkXXktttttsXXXXXt....',
  '....kXXXXXktttttsXXXXXXt...',
  'kkkkkkkXXkktskktskXXXkkkkkt',
  'kksssssssskttkstskssssssskt',
  '.kk.......XXXkXXt.......tt.',
  '.kk.......XXXkXXt.......tt.',
  '.kk......SXXXkXXXX......tt.',
  '.kk......SttskkttS......tt.',
  '.kk.....Skssskkssst.....tt.',
  '.kk......Skkkkkkks......tt.',
  '.kk.....SXXXSksSXXt.....tt.',
  '.kk.........Sks.........tt.',
  '..........Skkkkkt..........',
  '.........Ss.....ts.........'
]
/** Terminal at the desk, 26 cells wide. */
const TERMINAL_DESK: readonly string[] = [
  '......skkkkkkkkkkkkk......',
  '.....sSSSSSSSSSSSSSSk.....',
  '.....stSSSSSSSSSSSSSk.....',
  '.....sSSSSSSSSSSSSSSk.....',
  '.....sSSSSSSSSSSSSSSk.....',
  '.....stSSSSSSSSSSSSSk.....',
  '.....sSSSSSSSSSSSSSSk.....',
  '....tXXXXXXXXXXXXXXXXX....',
  '....tXXXXXXXXXXXXXXXXX....',
  '.....XXXXXXXXXXXXXXXX.....',
  '.....XXXXXXXXXXXXXXXX.....',
  '.....XXXXXXXXXXXXXXXX.....',
  '.....XXXXXXXXXXXXXXXX.....',
  '......XXXXXXXXXXXXXX......',
  '......XXXXkkkkkkXXXX......',
  '....tXXXXkttttttkXXXXX....',
  '...XXXXXXkttttttkXXXXXXX..',
  'skkkkkXXXkttkkttkXXXkkkkkk',
  'sssssssXXkttkkttkXXssssssk',
  '.st....XXXXXkkXXXXX.....k.',
  '.st....XXXXXkkXXXXX.....k.',
  '.st.....XXXXkkXXXX......k.',
  '.st......tttkkttt.......k.',
  '.st.....kssskksssk......k.',
  '.st......kkkkkkkk.......k.',
  '.tt.....XXX.kk.XXX......k.',
  '.tt.........kk..........k.',
  '..........kkkkkk..........',
  '.........kS.....k.........'
]
/** Block at the desk, 27 cells wide. */
const BLOCK_DESK: readonly string[] = [
  '......kkkkkkkkkkkkkkk......',
  '.....kSSSSSSSSSSSSSSSk.....',
  '.....kSSSSSSSSSSSSSSSk.....',
  '.....kSSSSSSSSSSSSSSSk.....',
  '.....kSSXXXXXXXSSSSSSk.....',
  '.....kSSXXXXXXXXXXSSSk.....',
  '.....kSSXXXXXXXXXXSSSk.....',
  '.....kSSXXXXXXXXXXSSSk.....',
  '.....kSSXXXXXXXXXXSSSk.....',
  '.....kSSXXXXXXXXXXSSSk.....',
  '.....kSSXXXXXXXSSSSSSk.....',
  '.....kSSXXXXXXXSSSSSSk.....',
  '.....kkkXXXXXXXkkkkkkk.....',
  '........XXXXXXX............',
  '........XXXkkkkkk..........',
  '....kXXXXXkttttttkXXXkk....',
  '...kkXXXXXkttttttkXXXXXk...',
  'kkkkkXXkXXkttkkttkXXXkkkkkk',
  'kssssXXsXXkttkkttkXXXsssssk',
  '.k...XX.XXXXXkkXXXXXX....k.',
  '.k......XXXXXkkXXXXXX....k.',
  '.k......XXXXXkkXXXXXX....k.',
  '.k........tttkktttX......k.',
  '.k.......kssskksssk......k.',
  '.k.......XkkkkkkkkXX.....k.',
  '.k...........kk..........k.',
  '.k...........kk..........k.',
  '...........kkkkkk..........',
  '..........k......k.........'
]
/** Loop at the desk, 26 cells wide. */
const LOOP_DESK: readonly string[] = [
  '......kkkkkkkkkkkkkks.....',
  '.....kSSSSSSSSSSSSSSts....',
  '.....kSSSSSSSSSSSSSSts....',
  '.....kSSSSSSSSSSSSSSts....',
  '.....kSSSSSSSSSSSSSSts....',
  '.....kSSSXXXXXXXXXSSts....',
  '.....kSSXXXXXXXXXXXSSs....',
  '.....kSXXXXXXXXXXXXXSs....',
  '.....kSXXXXXXXXXXXXXSs....',
  '.....kSXXXXXXXXXXXXXts....',
  '.....kSXXXXXXXXXXXXXts....',
  '.....kSXXXXXSSSSXXXXSs....',
  '......kXXXXXkkkkXXXXs.....',
  '.......XXXXXkkk...........',
  '......XXXXXkkkkkk.........',
  '....XXXXXXkttttttkkkXXt...',
  '...kXXXXXXkttttttkXXXXXs..',
  'kkkkkkkXXXkttkkttkXXkkkkks',
  'kssssssXXXkttkkttkXXssssss',
  '.k.....XXXXXXkkXXXXX...Ss.',
  '.k......XXXXXkkXXXX....Ss.',
  '.k......SXXXXkkXXX.....Ss.',
  '.k........tttkkttt.....Ss.',
  '.k.......kssskkssss....Ss.',
  '.k........kkkkkkkk.....Ss.',
  '.k.......XX.SkkSXX.....Ss.',
  '.k..........Skk........Ss.',
  '...........kkkkkk.........',
  '..........k.....Sk........'
]

/** Clawd, facing forward, 15 by 10 cells. */
const CLAWD_FRONT: readonly string[] = [
  '..XXXXXXXXXXX..',
  '..XXXXXXXXXXX..',
  '..XXWXXXXXWXX..',
  '..XXWXXXXXWXX..',
  'XXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXX',
  '..XXXXXXXXXXX..',
  '..XXXXXXXXXXX..',
  '...X.X...X.X...',
  '...X.X...X.X...'
]

/** Bit, facing forward, 12 by 22 cells. */
const BIT_FRONT: readonly string[] = [
  'XXXX....XXXX',
  '.XX......XX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXWXXXXWXXX',
  'XXXWXXXXWXXX',
  'XXXWXXXXWXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '...XXXXXX...',
  '...XXXXXX...',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  '.X.XXXXXX.X.',
  '.X.XXXXXX.X.',
  '...XXXXXX...',
  '...XXXXXX...',
  '...XXXXXX...',
  '...XX..XX...',
  '...XX..XX...',
  '..XXX..XXX..'
]

/** Terminal, facing forward, 14 by 11 cells. */
const TERMINAL_FRONT: readonly string[] = [
  '.XXXXXXXXXXXX.',
  '..XDDDDDDDDX..',
  '..XDDWDDWDDX..',
  '..XDDWDDWDDX..',
  '..XDDDDDDDDX..',
  'XXXXDDDDDDXXXX',
  'X..XDDDDDDX..X',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '..............',
  '....XX..XX....'
]

/** Block, facing forward, 12 by 15 cells. */
const BLOCK_FRONT: readonly string[] = [
  '..XXXXX.....',
  '..XXXXX.XX..',
  '..XWXWX.XX..',
  '..XWXWXXXX..',
  '..XXXXXXXX..',
  '..XXXXX.....',
  '..XXXXX.....',
  '..XXXXX.....',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'X.XXXXXXXXXX',
  'X.XXXXXXXXXX',
  '..XXXXXXXXXX',
  '...XX....X..',
  '...XX....XX.'
]

/** Loop, facing forward, 14 by 16 cells. */
const LOOP_FRONT: readonly string[] = [
  '...XXXXXXXX...',
  '..XXXXXXXXXX..',
  '..XXXWXXWXXX..',
  '..XXXWXXWXXX..',
  '..XXXXXXXXXX..',
  '..XXX....XXX..',
  '..XXX....XXX..',
  'XXXXX.........',
  'XXXXX.........',
  'X.XXX....XXXXX',
  'X.XXXXXXXXXX.X',
  '..XXXXXXXXXX..',
  '..XXXXXXXXXX..',
  '...XXXXXXXX...',
  '.....X..X.....',
  '....XX..XX....'
]

export const FRONT_GRIDS: Record<PixelVariant, readonly string[]> = {
  clawd: CLAWD_FRONT,
  bit: BIT_FRONT,
  terminal: TERMINAL_FRONT,
  block: BLOCK_FRONT,
  loop: LOOP_FRONT
}

export type FigurePalette = {
  body: string
  /** A darker shade of the body: Terminal's screen. */
  shade: string
  eye: string
}

/** One rect per horizontal run of a colour, for a front-facing figure. */
export function figureRects(rows: readonly string[], palette: FigurePalette): DeskRect[] {
  return runs(rows, { X: palette.body, D: palette.shade, W: palette.eye })
}

export const VARIANT_GRIDS: Record<PixelVariant, readonly string[]> = {
  clawd: CLAWD_DESK,
  bit: BIT_DESK,
  terminal: TERMINAL_DESK,
  block: BLOCK_DESK,
  loop: LOOP_DESK
}

/** The site's furniture colours, so the desk reads as the same desk. */
export const DESK_WOOD = '#483828'
export const DESK_SEAT = '#a89878'
export const DESK_SEAT_DARK = '#886848'

export type DeskPalette = {
  body: string
  screen: string
  wood?: string
  seat?: string
  seatDark?: string
}

export type DeskRect = { x: number; y: number; w: number; fill: string }

export function gridWidth(rows: readonly string[]): number {
  return rows[0]?.length ?? 0
}

/** One rect per horizontal run of a painted cell, top to bottom. */
function runs(rows: readonly string[], fills: Record<string, string>): DeskRect[] {
  const rects: DeskRect[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.') {
        x += 1
        continue
      }
      let w = 1
      while (row[x + w] === ch) w += 1
      rects.push({ x, y, w, fill: fills[ch] })
      x += w
    }
  })
  return rects
}

/** One rect per horizontal run of a colour, for a desk. */
export function deskRects(rows: readonly string[], palette: DeskPalette): DeskRect[] {
  return runs(rows, {
    k: palette.wood ?? DESK_WOOD,
    t: palette.seat ?? DESK_SEAT,
    s: palette.seatDark ?? DESK_SEAT_DARK,
    X: palette.body,
    S: palette.screen
  })
}

export type Cell = { x: number; y: number }
export type Run = { x: number; y: number; w: number }
export type Box = { x: number; y: number; w: number; h: number }

export type DeskLayers = {
  /** Wood and seat cells with their palette character. */
  furniture: (Run & { ch: string })[]
  /** The agent's body minus the hands. */
  body: Run[]
  /** Left and right forearms at desk height; they take turns rising to type. */
  handL: Run[]
  handR: Run[]
  /** The monitor's screen, one rect, recoloured when the agent is working. */
  screen: Box
  /** Row index of the desk top. */
  deskRow: number
}

/** Merge horizontally adjacent cells into runs, one rect each. */
export function runsOf(cells: Cell[]): Run[] {
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x)
  const runs: Run[] = []
  for (const c of sorted) {
    const last = runs[runs.length - 1]
    if (last && last.y === c.y && last.x + last.w === c.x) last.w += 1
    else runs.push({ x: c.x, y: c.y, w: 1 })
  }
  return runs
}

function bbox(cells: Cell[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const c of cells) {
    x0 = Math.min(x0, c.x)
    y0 = Math.min(y0, c.y)
    x1 = Math.max(x1, c.x + 1)
    y1 = Math.max(y1, c.y + 1)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Splits a seated grid into the parts the animation moves or recolours.
 *
 * The site's `layersOf` (`crew-layers.ts` in open-room-site), ported as
 * is: the desk top is the first row where wood reaches both edges; the
 * screen is the pale block above it; the hands are body cells at desk
 * height outside the chair, which is the run of seat and wood around the
 * centre column on the row above the desk.
 */
export function deskLayers(rows: readonly string[]): DeskLayers {
  const width = gridWidth(rows)
  const cells = (pred: (ch: string, x: number, y: number) => boolean): Cell[] => {
    const out: Cell[] = []
    rows.forEach((line, y) => {
      for (let x = 0; x < line.length; x += 1) if (pred(line[x], x, y)) out.push({ x, y })
    })
    return out
  }

  const deskRow = rows.findIndex(
    (line) => line.indexOf('k') <= 2 && line.lastIndexOf('k') >= line.length - 3
  )
  const screen = bbox(cells((ch, _x, y) => ch === 'S' && y < deskRow - 4))

  const centre = Math.floor(width / 2)
  const chairLine = rows[deskRow - 1]
  let chairL = centre
  let chairR = centre
  while (chairL > 0 && 'kts'.includes(chairLine[chairL - 1])) chairL -= 1
  while (chairR < width - 1 && 'kts'.includes(chairLine[chairR + 1])) chairR += 1
  const isHandRow = (y: number): boolean => y >= deskRow - 2 && y <= deskRow
  const handL = cells((ch, x, y) => ch === 'X' && isHandRow(y) && x < chairL)
  const handR = cells((ch, x, y) => ch === 'X' && isHandRow(y) && x > chairR)
  const hand = new Set([...handL, ...handR].map((c) => `${c.x},${c.y}`))
  const body = cells((ch, x, y) => ch === 'X' && !hand.has(`${x},${y}`))

  const furniture: (Run & { ch: string })[] = []
  for (const ch of ['k', 't', 's']) {
    for (const run of runsOf(cells((c) => c === ch))) furniture.push({ ...run, ch })
  }

  return {
    furniture,
    body: runsOf(body),
    handL: runsOf(handL),
    handR: runsOf(handR),
    screen,
    deskRow
  }
}

/** Lines of output on a busy screen: every other row, ragged widths. */
export function outputLines(screen: Box): { y: number; w: number }[] {
  const widths = [0.75, 0.45, 0.9, 0.6]
  const lines: { y: number; w: number }[] = []
  for (let i = 0; i < widths.length; i += 1) {
    const y = screen.y + 1 + i * 2
    if (y >= screen.y + screen.h - 1) break
    lines.push({ y, w: Math.max(2, Math.round((screen.w - 2) * widths[i])) })
  }
  return lines
}
