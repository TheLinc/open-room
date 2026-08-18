import { useCallback, useEffect, useRef, useState } from 'react'
import { Endpointer, type EndpointerVerdict } from '@shared/endpointer'
import { encodePcm } from '@shared/pcm'
import {
  HIDDEN_OVERLAY,
  type OverlayEvent,
  type OverlayState,
  type PipEntry
} from '@shared/voice-input'
import { Capture } from './capture'
import { Hud } from './components/hud'
import { Pill } from './components/pill'

/**
 * The overlay's root.
 *
 * Renders whatever main says the state is and nothing else — the overlay never
 * decides its own phase. It owns the microphone and the endpointer because
 * that is where the audio is, but it only ever reports what it observed; main
 * decides what that means.
 */

/** Verdicts worth telling main about. `listening` is the steady state. */
const REPORTED: Partial<Record<EndpointerVerdict, OverlayEvent>> = {
  'speech-started': { type: 'speechStarted' },
  'ended-silence': { type: 'silence' },
  'cancelled-no-speech': { type: 'noSpeech' },
  'ended-max-duration': { type: 'maxDuration' }
}

export default function App(): React.JSX.Element | null {
  const [state, setState] = useState<OverlayState>(HIDDEN_OVERLAY)
  const [pips, setPips] = useState<PipEntry[]>([])

  /**
   * Current microphone level, 0–1.
   *
   * Held in a ref and read by the waveform's animation loop rather than passed
   * as a prop: it changes every frame, and re-rendering React at frame rate to
   * move twelve bars would be pointless.
   */
  const level = useRef(0)
  const readLevel = useCallback(() => level.current, [])

  useEffect(() => window.overlay.onState(setState), [])
  useEffect(() => window.overlay.onPips(setPips), [])

  useEffect(() => {
    const capture = new Capture()
    let endpointer: Endpointer | null = null
    let startedAt = 0
    let frame = 0

    /**
     * One loop per frame drives both the endpointer and the waveform.
     *
     * requestAnimationFrame rather than a timer: it is already the waveform's
     * clock, and it stops when the overlay is hidden, which is precisely when
     * there is nothing to measure.
     */
    const poll = (): void => {
      frame = requestAnimationFrame(poll)
      if (!endpointer) return

      const rms = capture.level()
      level.current = rms

      const reportable = REPORTED[endpointer.push(rms, performance.now() - startedAt)]
      if (reportable) window.overlay.reportEvent(reportable)
    }

    const stopPolling = (): void => {
      cancelAnimationFrame(frame)
      frame = 0
      endpointer = null
      level.current = 0
    }

    const offStart = window.overlay.onStartCapture(() => {
      void capture
        .start()
        .then(() => {
          endpointer = new Endpointer()
          startedAt = performance.now()
          if (!frame) frame = requestAnimationFrame(poll)
        })
        .catch((error: unknown) => {
          // The overlay is the only window that can be on screen when this
          // fails, and a silent failure here looks exactly like a dead app.
          window.overlay.reportEvent({
            type: 'failed',
            message:
              error instanceof Error && error.name === 'NotAllowedError'
                ? 'Microphone access was denied'
                : 'Could not open the microphone'
          })
        })
    })

    const offStop = window.overlay.onStopCapture(() => {
      stopPolling()
      void capture.stop().then((samples) => window.overlay.reportAudio(encodePcm(samples)))
    })

    const offDiscard = window.overlay.onDiscardCapture(() => {
      stopPolling()
      capture.discard()
    })

    return () => {
      stopPolling()
      capture.discard()
      offStart()
      offStop()
      offDiscard()
    }
  }, [])

  // A voice interaction always wins the space. The HUD is ambient and the
  // pill is a live conversation — stacking them would put two competing
  // things under the same glance.
  const body =
    state.phase !== 'hidden' ? (
      <Pill state={state} level={readLevel} onHoverChange={window.overlay.reportHover} />
    ) : pips.length > 0 ? (
      <Hud pips={pips} />
    ) : null

  if (!body) return null

  return <div className="flex h-full items-end justify-center pb-3">{body}</div>
}
