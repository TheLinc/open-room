import { useEffect, useState } from 'react'
import { HIDDEN_OVERLAY, type OverlayState } from '@shared/voice-input'

/**
 * The overlay's root.
 *
 * Renders whatever main says the state is and nothing else — the overlay never
 * decides its own phase. Task 10 replaces this placeholder with the pill.
 */
export default function App(): React.JSX.Element | null {
  const [state, setState] = useState<OverlayState>(HIDDEN_OVERLAY)

  useEffect(() => window.overlay.onState(setState), [])

  if (state.phase === 'hidden') return null

  return (
    <div className="flex h-full items-end justify-center pb-3">
      <div
        className="flex items-center gap-2.5 rounded-full border border-white/10 bg-[#101722]/90 px-3.5 py-2 shadow-2xl backdrop-blur"
        style={{ color: state.agentColor }}
      >
        <span
          className="block size-2 rounded-full"
          style={{ background: state.agentColor, boxShadow: `0 0 9px ${state.agentColor}` }}
        />
        <span className="text-[11.5px] font-semibold text-slate-100">{state.agentName}</span>
        {state.conversationTitle ? (
          <span className="text-[9.5px] text-slate-100/50">· {state.conversationTitle}</span>
        ) : null}
        <span className="text-[9.5px]">{state.message || state.phase}</span>
      </div>
    </div>
  )
}
