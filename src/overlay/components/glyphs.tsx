/**
 * The leading glyph slot.
 *
 * It holds exactly one value at a time, and the progression reads as a
 * handoff: mic (you are the source) → dimmed mic (you have stopped, it is
 * thinking) → tick (handed over) → circle (the agent is the source).
 *
 * Colour is never used for state. It always answers one question — which
 * agent this is — which is what lets the same pill say "Atlas is speaking"
 * and "you are speaking to Atlas" with the same parts.
 */

export function MicGlyph({ dim = false }: { dim?: boolean }): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      aria-hidden
      className={dim ? 'or-glyph shrink-0 opacity-40' : 'or-glyph shrink-0'}
    >
      <rect x="4.4" y="1.2" width="3.2" height="5.6" rx="1.6" fill="currentColor" />
      <path d="M2.8 6.2a3.2 3.2 0 0 0 6.4 0" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <path d="M6 9.4v1.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

export function TickGlyph(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="or-glyph shrink-0">
      <path
        d="M2.4 6.4 4.8 8.8 9.6 3.6"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CircleGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="or-glyph block size-2 shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 9px ${color}` }}
    />
  )
}

/**
 * Arcs radiating outward — the agent's voice leaving, rather than a voice
 * being sampled. A different shape, not a different colour of the same shape,
 * so the two are not confusable in peripheral vision.
 */
export function Arcs({ color }: { color: string }): React.JSX.Element {
  return (
    <span aria-hidden className="relative block h-5 w-6 shrink-0">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="or-arc absolute top-1/2 left-px block size-2 rounded-full"
          style={{
            border: `1.4px solid ${color}`,
            borderLeftColor: 'transparent',
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            marginTop: '-4px',
            animationDelay: `${i * 500}ms`
          }}
        />
      ))}
    </span>
  )
}

/** Three dots pulsing while the transcript is being produced. */
export function Shimmer({ color }: { color: string }): React.JSX.Element {
  return (
    <span aria-hidden className="flex h-[18px] shrink-0 items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="or-blip block size-1 rounded-full"
          style={{ background: color, animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  )
}
