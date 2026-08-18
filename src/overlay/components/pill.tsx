import { useState } from 'react'
import type { OverlayState } from '@shared/voice-input'
import { Waveform } from './waveform'
import { Arcs, CircleGlyph, MicGlyph, Shimmer, TickGlyph } from './glyphs'

/**
 * The bottom-centre bubble.
 *
 * Everything the user needs before they speak is on screen before they speak:
 * which agent is listening, in its identity colour, and which conversation the
 * words will land in. That visibility is the whole safeguard against a spoken
 * message reaching an agent it was not meant for.
 */
export function Pill({
  state,
  level,
  onHoverChange
}: {
  state: OverlayState
  level: () => number
  onHoverChange?: (hovered: boolean) => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const color = state.agentColor || '#71717a'
  const dispatched = state.phase === 'dispatched'

  const glyph =
    state.phase === 'listening' ? (
      <MicGlyph />
    ) : state.phase === 'transcribing' ? (
      <MicGlyph dim />
    ) : dispatched ? (
      <TickGlyph />
    ) : (
      <CircleGlyph color={color} />
    )

  const trailing =
    state.phase === 'listening' ? (
      <Waveform level={level} color={color} running />
    ) : state.phase === 'transcribing' ? (
      <Shimmer color={color} />
    ) : state.phase === 'speaking' ? (
      <Arcs color={color} />
    ) : null

  const setHover = (next: boolean): void => {
    setHovered(next)
    onHoverChange?.(next)
  }

  return (
    <div
      className={[
        'or-surface or-enter flex flex-col gap-1.5 px-3.5 py-2 leading-normal',
        // Only the dispatched bubble has a second line, and only it needs a
        // predictable width for the transcript to truncate against.
        dispatched ? 'w-[320px] rounded-xl' : 'rounded-full',
        state.phase === 'speaking' ? 'or-emit' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        state.phase === 'speaking'
          ? ({
              borderColor: `${color}73`,
              '--or-halo-soft': `${color}2e`,
              '--or-halo-mid': `${color}21`,
              '--or-halo-strong': `${color}5c`
            } as React.CSSProperties)
          : undefined
      }
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-2.5" style={{ color }}>
        {glyph}

        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[11.5px] leading-normal font-semibold text-slate-100">
            {state.agentName}
          </span>
          {state.conversationTitle ? (
            <span className="truncate text-[9.5px] leading-normal text-slate-100/50">
              · {state.conversationTitle}
            </span>
          ) : null}
        </span>

        {trailing ? <span className="ml-auto flex items-center">{trailing}</span> : null}
      </div>

      {dispatched && state.transcript ? (
        <div
          className={[
            'text-[10px] leading-[1.5] text-slate-100/85 italic',
            // One line by default, with a faded right edge rather than an
            // ellipsis: a fade says "there is more" without pretending the
            // truncation is the message. The full text is in the chat pane.
            hovered ? '' : 'overflow-hidden whitespace-nowrap'
          ]
            .filter(Boolean)
            .join(' ')}
          style={
            hovered
              ? undefined
              : {
                  maskImage: 'linear-gradient(to right, #000 68%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to right, #000 68%, transparent 100%)'
                }
          }
        >
          “{state.transcript}”
        </div>
      ) : null}

      {state.phase === 'error' && state.message ? (
        <div className="text-[10px] leading-normal text-slate-100/70">{state.message}</div>
      ) : null}
    </div>
  )
}
