import { useEffect } from 'react'
import type { OverlayState } from '@shared/voice-input'
import { useHitBox } from '../use-hit-box'
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
  // Not clickable: a transient bubble you can hit by accident while reaching
  // for what is underneath is a bug. The box is reported purely so main can
  // tell us when the cursor is on it.
  const { ref, hovered } = useHitBox(false)
  const color = state.agentColor || '#71717a'
  const dispatched = state.phase === 'dispatched'
  const asking = state.phase === 'asking'
  const answered = state.phase === 'answered'
  // The bubbles with a second line: a prompt, a question, or an answer.
  const wide = dispatched || asking || answered

  const glyph =
    state.phase === 'listening' ? (
      <MicGlyph />
    ) : state.phase === 'transcribing' ? (
      <MicGlyph dim />
    ) : dispatched || answered ? (
      <TickGlyph />
    ) : (
      <CircleGlyph color={color} />
    )

  const trailing =
    state.phase === 'listening' ? (
      <Waveform level={level} color={color} running />
    ) : state.phase === 'transcribing' || asking ? (
      <Shimmer color={color} />
    ) : state.phase === 'speaking' ? (
      <Arcs color={color} />
    ) : null

  // Main pauses the dismissal timer while the pointer is here, so the bubble
  // does not vanish out from under the expansion you reached for.
  useEffect(() => onHoverChange?.(hovered), [hovered, onHoverChange])

  return (
    <div
      ref={ref}
      className={[
        'or-surface or-enter flex flex-col gap-1.5 px-3.5 py-2 leading-normal',
        // Only the dispatched bubble has a second line, and only it needs a
        // predictable width for the transcript to truncate against.
        wide ? 'w-[320px] rounded-xl' : 'rounded-full',
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
    >
      <div className="flex items-center gap-2.5" style={{ color }}>
        {glyph}

        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[11.5px] leading-normal font-semibold text-or-fg">
            {state.agentName}
          </span>
          {state.conversationTitle ? (
            <span className="truncate text-[9.5px] leading-normal text-or-fg/50">
              · {state.conversationTitle}
            </span>
          ) : null}
        </span>

        {trailing ? <span className="ml-auto flex items-center">{trailing}</span> : null}
      </div>

      {/* A side question is labelled as one, since the words are not going
          into the conversation and the user should see that they were
          heard that way. */}
      {state.aside && wide ? (
        <div className="text-[9px] leading-normal tracking-wide text-or-fg/50 uppercase">
          Side question
        </div>
      ) : null}

      {wide && state.transcript ? (
        <div
          className={[
            'text-[10px] leading-[1.5] text-or-fg/85 italic',
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

      {/* The answer is read, not glanced at: full width, wrapped, no fade. */}
      {answered && state.answer ? (
        <div className="text-[10.5px] leading-[1.45] text-or-fg">{state.answer}</div>
      ) : null}

      {asking ? <div className="text-[10px] leading-normal text-or-fg/70">Asking…</div> : null}

      {/* A tick over a prompt waiting behind a two-minute task would say
          "delivered"; the pane that lists the queue is usually hidden. */}
      {dispatched && state.queued ? (
        <div className="text-[10px] leading-normal text-or-fg/70">
          Queued behind the current task
        </div>
      ) : null}

      {/* Not gated on the error phase: a capture cut by the time-limit
          failsafe still transcribes and dispatches, and the message is how
          the user learns the prompt was truncated. */}
      {state.message ? (
        <div className="text-[10px] leading-normal text-or-fg/70">{state.message}</div>
      ) : null}
    </div>
  )
}
