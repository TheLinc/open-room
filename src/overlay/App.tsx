import { useCallback, useEffect, useRef, useState } from 'react'
import { HIDDEN_OVERLAY, type OverlayState } from '@shared/voice-input'
import { Pill } from './components/pill'

/**
 * The overlay's root.
 *
 * Renders whatever main says the state is and nothing else — the overlay never
 * decides its own phase. It reports what it observes (hover now, endpointer
 * verdicts once capture lands) and main decides what that means.
 */
export default function App(): React.JSX.Element | null {
  const [state, setState] = useState<OverlayState>(HIDDEN_OVERLAY)

  /**
   * Current microphone level, 0–1.
   *
   * Held in a ref and read by the waveform's animation loop rather than passed
   * as a prop: it changes every frame, and re-rendering React at frame rate to
   * move twelve bars would be pointless. Capture replaces the source; until
   * then it reports silence, which the waveform draws as its idle floor.
   */
  const level = useRef(0)
  const readLevel = useCallback(() => level.current, [])

  useEffect(() => window.overlay.onState(setState), [])

  if (state.phase === 'hidden') return null

  return (
    <div className="flex h-full items-end justify-center pb-3">
      <Pill state={state} level={readLevel} />
    </div>
  )
}
