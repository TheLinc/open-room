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
 * hid filled in: the monitor's bottom bezel, a stand that reaches the desk,
 * a desk surface for it to stand on, and the chair in front. The first cut
 * left the surface unpainted and the monitor read as floating.
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
  '..............kk..............',
  '............kkkkkk............',
  '..kkkkkkkkkkkkkkkkkkkkkkkkkk..',
  '..kssssssssssssssssssssssssk..',
  '...k........kkkkkk........k...',
  '...k.......kttttttk.......k...',
  '...k.......kttttttk.......k...',
  '...k.......kttkkttk.......k...',
  '...k..........kk..........k...',
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
