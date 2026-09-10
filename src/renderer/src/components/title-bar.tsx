import logoUrl from '@/assets/logo.png'

/**
 * The window's title bar, drawn by the app rather than the OS.
 *
 * Windows paints its caption bar in the user's accent colour — navy for one
 * person, hot pink for another, and a pale grey for everybody the moment the
 * window loses focus. None of that is reachable from CSS, so the only way for
 * the top of the window to match the rest of it is to draw it here and let
 * the OS keep just the buttons, tinted to suit (`titleBarOverlay` in
 * `createWindow`).
 *
 * The strip is a drag region, which is what replaces the caption bar Windows
 * would otherwise have given us: without it the window cannot be moved at
 * all. Anything interactive placed in here must opt back out with
 * `app-region: no-drag`, or it will be swallowed by the drag.
 */

/**
 * macOS puts its traffic lights inside the window, over this strip.
 *
 * Windows and Linux report the reserved area through the
 * `titlebar-area-*` env vars, but macOS has no equivalent, so the space is
 * reserved by hand. `userAgent` rather than the deprecated `navigator.platform`.
 */
const IS_MAC = navigator.userAgent.includes('Macintosh')

export function TitleBar(): React.JSX.Element {
  return (
    <header
      // Tailwind has no utility for this, and it is the one property the
      // whole component exists for.
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="flex h-10 shrink-0 items-center gap-2 bg-background select-none"
    >
      <div className="flex items-center gap-2" style={{ paddingLeft: IS_MAC ? 80 : 12 }}>
        {/* The mark is a mask filled with the foreground colour, so one asset
            serves both themes: the PNG is the light variant, a flat grey on
            transparent, and only its alpha is used. Sized by height, with the
            mark's own aspect ratio giving the width: it is about two and a
            half times taller than it is wide. A span rather than an img also
            means a press on it drags the window instead of the image. */}
        <span
          aria-hidden
          className="h-5 shrink-0 bg-foreground/85"
          style={{
            aspectRatio: '218 / 545',
            maskImage: `url(${logoUrl})`,
            maskSize: 'contain',
            maskRepeat: 'no-repeat',
            maskPosition: 'center'
          }}
        />
        <span className="text-xs font-medium tracking-tight text-foreground/90">Open Room</span>
      </div>
    </header>
  )
}
