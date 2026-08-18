import { useEffect, useState } from 'react'
import { HIDDEN_OVERLAY, type OverlayState } from '@shared/voice-input'

/**
 * The overlay's root.
 *
 * Renders whatever main says the state is and nothing else — the overlay never
 * decides its own phase.
 *
 * This is scaffolding: Task 10 replaces the body with the designed pill (mic
 * glyph → dimmed mic → tick → circle, the centred equaliser, radiating arcs
 * and the halo). What is here now exists to prove state arrives from main.
 */
export default function App(): React.JSX.Element | null {
  const [state, setState] = useState<OverlayState>(HIDDEN_OVERLAY)

  useEffect(() => window.overlay.onState(setState), [])

  if (state.phase === 'hidden') return null

  return (
    <div className="flex h-full items-end justify-center pb-3">
      <div className="or-surface flex items-center gap-2.5 rounded-full px-3.5 py-2 leading-normal">
        <span
          aria-hidden
          className="block size-2 shrink-0 rounded-full"
          style={{
            background: state.agentColor,
            boxShadow: `0 0 9px ${state.agentColor}`
          }}
        />
        <span className="text-[11.5px] leading-normal font-semibold text-slate-100">
          {state.agentName}
        </span>
        {state.conversationTitle ? (
          <span className="text-[9.5px] leading-normal text-slate-100/50">
            · {state.conversationTitle}
          </span>
        ) : null}
        <span className="text-[9.5px] leading-normal" style={{ color: state.agentColor }}>
          {state.message || state.phase}
        </span>
      </div>
    </div>
  )
}
