import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Square } from 'lucide-react'
import { HEARING_LEVEL, meterLevel, meterVerdict, type MeterVerdict } from '@shared/meter'
import { Button } from '@/components/ui/button'

/**
 * "Is this the microphone I am actually talking into?"
 *
 * A device list alone cannot answer that — the labels are ambiguous, several
 * of them are plausible, and the system default is frequently the wrong one.
 * So this offers the only answer that settles it: say something and watch.
 *
 * The microphone is opened on a press rather than whenever the dialog is on
 * screen. Voice input ships off in this app deliberately, and a settings
 * panel that silently lights the OS microphone indicator would undercut that.
 */

/** Segments in the bar. Enough to read as a level, few enough to read at a glance. */
const SEGMENTS = 24

const VERDICT_TEXT: Record<MeterVerdict, string> = {
  waiting: 'Say something…',
  hearing: 'Hearing you — this is the right microphone.',
  silent: 'Nothing yet. If this stays empty, try another device.'
}

export function MicMeter({ disabled }: { disabled?: boolean }): React.JSX.Element {
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [peak, setPeak] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  /**
   * When the test started, for the verdict's grace period.
   *
   * A ref rather than state: the tick below already re-renders, and storing it
   * twice invites the two disagreeing.
   */
  const startedAt = useRef(0)

  useEffect(
    () =>
      window.openRoom.onMicrophoneLevel((rms) => {
        // null is main saying the test is over — including when it stopped on
        // its own timeout, which the button would otherwise never learn about.
        if (rms === null) {
          setTesting(false)
          setLevel(0)
          return
        }

        const next = meterLevel(rms)
        setLevel(next)
        setPeak((current) => Math.max(current, next))
      }),
    []
  )

  // The verdict has to reach `silent` on its own, with no audio arriving to
  // drive it — a dead microphone sends nothing at all, which is the case the
  // whole control exists to catch.
  useEffect(() => {
    if (!testing) return
    const id = setInterval(() => setElapsed(performance.now() - startedAt.current), 250)
    return () => clearInterval(id)
  }, [testing])

  const toggle = (): void => {
    const next = !testing
    setTesting(next)
    setLevel(0)
    setPeak(0)
    setElapsed(0)
    startedAt.current = performance.now()
    window.openRoom.setMicrophoneTest(next)
  }

  // Stop the test if the dialog closes while it is running, rather than
  // leaving main's timeout to notice a minute later.
  useEffect(() => () => window.openRoom.setMicrophoneTest(false), [])

  const verdict = meterVerdict(peak, elapsed)
  const filled = Math.round(level * SEGMENTS)
  const hearingMark = Math.round(HEARING_LEVEL * SEGMENTS)

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={testing ? 'secondary' : 'outline'}
        size="sm"
        disabled={disabled}
        onClick={toggle}
      >
        {testing ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
        {testing ? 'Stop test' : 'Test microphone'}
      </Button>

      {testing && (
        <div className="space-y-1.5">
          <div className="flex h-6 items-center gap-[2px]" aria-hidden>
            {Array.from({ length: SEGMENTS }, (_, index) => (
              <div
                key={index}
                className={[
                  'flex-1 rounded-[1px] transition-[height,background-color] duration-75',
                  index < filled
                    ? index >= hearingMark
                      ? 'h-6 bg-emerald-500'
                      : 'h-4 bg-emerald-500/60'
                    : // The unfilled track stays visible so an empty bar reads
                      // as "nothing arriving" rather than as a missing control.
                      'h-2 bg-muted'
                ].join(' ')}
              />
            ))}
          </div>

          <p
            className={[
              'flex items-center gap-1.5 text-xs',
              verdict === 'hearing'
                ? 'text-emerald-600 dark:text-emerald-400'
                : verdict === 'silent'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground'
            ].join(' ')}
            // The bar is decorative; this line is what a screen reader needs,
            // and it changes rarely enough that `polite` will not chatter.
            role="status"
            aria-live="polite"
          >
            {verdict === 'silent' && <MicOff className="size-3.5 shrink-0" />}
            {VERDICT_TEXT[verdict]}
          </p>
        </div>
      )}
    </div>
  )
}
