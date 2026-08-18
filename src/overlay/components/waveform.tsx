import { useEffect, useRef } from 'react'

const BARS = 12

/**
 * A silent room must not look like a dead microphone.
 *
 * Silence is what ends a recording, so it is on screen every single time —
 * and bars flattened to nothing are indistinguishable from a broken capture.
 * The floor keeps them breathing.
 */
const IDLE_FLOOR = 0.12

/** How much of the gap to close each frame. Lower is smoother and laggier. */
const SMOOTHING = 0.35

/** Amplitude is RMS, which for speech sits well below 1. */
const GAIN = 6

/**
 * Twelve bars growing outward from an invisible centre line.
 *
 * Written with `transform: scaleY` rather than `height`, so every frame stays
 * on the compositor and never triggers layout — this animates continuously on
 * top of whatever the user is working in.
 *
 * The loop reads a getter rather than props because it runs at frame rate:
 * re-rendering React sixty times a second to move twelve bars would be absurd.
 */
export function Waveform({
  level,
  color,
  running
}: {
  level: () => number
  color: string
  running: boolean
}): React.JSX.Element {
  const bars = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    if (!running) return

    let raf = 0
    const heights = new Array<number>(BARS).fill(IDLE_FLOOR)

    const tick = (): void => {
      const amplitude = Math.min(1, level() * GAIN)

      for (let i = 0; i < BARS; i += 1) {
        // Taper towards the ends so the shape reads as a voice rather than a
        // level meter, and stagger it so neighbours do not move in lockstep.
        const distance = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2)
        const jitter = 0.7 + Math.random() * 0.6
        const target = Math.max(IDLE_FLOOR, amplitude * (1 - distance * 0.45) * jitter)

        heights[i] += (target - heights[i]) * SMOOTHING
        const bar = bars.current[i]
        if (bar) bar.style.transform = `scaleY(${heights[i].toFixed(3)})`
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [level, running])

  return (
    <span aria-hidden className="flex h-[18px] shrink-0 items-center gap-[2px]">
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el
          }}
          className="block h-full w-[2px] origin-center rounded-[1px]"
          style={{ background: color, transform: `scaleY(${IDLE_FLOOR})` }}
        />
      ))}
    </span>
  )
}
