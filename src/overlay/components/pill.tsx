import { useEffect } from 'react'
import type { OverlayState } from '@shared/voice-input'
import { useHitBox } from '../use-hit-box'
import { Waveform } from './waveform'
import { CircleGlyph, MicGlyph, Shimmer, TickGlyph } from './glyphs'
import { useGripVisible } from '../use-grip'
import { DragGrip } from './grip'

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
  // Clickable, for the cancel button, the drag grip and scrolling a long
  // answer. It used to pass clicks through, so nothing reaching past it could
  // hit it by accident; now that it can be dragged out of the way, the
  // controls are worth more than that.
  const { ref, hovered } = useHitBox(true)
  const grip = useGripVisible(hovered)
  const color = state.agentColor || '#71717a'
  const dispatched = state.phase === 'dispatched'
  const asking = state.phase === 'asking'
  const answered = state.phase === 'answered'
  // A refusal before any agent was chosen ("Voice input is turned off", "No
  // speech model installed") has no name to head the bubble, so the message
  // takes the name's place on the one line rather than hanging under an
  // empty header beside a grey dot.
  const bareError = state.phase === 'error' && !state.agentName
  // The transcript settling while the microphone is open.
  const live =
    (state.phase === 'listening' || state.phase === 'transcribing') &&
    (state.partial.committed !== '' || state.partial.tentative !== '')
  // The bubbles with a second line: a prompt, a question, an answer, or the
  // live transcript.
  const wide = dispatched || asking || answered || live
  // While the microphone is open or the words are being decoded, the capture
  // can still be thrown away: the same as Esc.
  const cancellable = state.phase === 'listening' || state.phase === 'transcribing'

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
        wide ? 'w-[320px] rounded-xl' : 'rounded-full'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-center gap-2.5" style={{ color }}>
        {grip ? <DragGrip vertical /> : null}
        {glyph}

        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[11.5px] leading-normal font-semibold text-or-fg">
            {bareError ? state.message : state.agentName}
          </span>
          {state.conversationTitle ? (
            <span className="truncate text-[9.5px] leading-normal text-or-fg/50">
              · {state.conversationTitle}
            </span>
          ) : null}
        </span>

        {trailing ? <span className="ml-auto flex items-center">{trailing}</span> : null}

        {cancellable ? (
          <button
            type="button"
            aria-label="Cancel"
            title="Cancel (Esc)"
            // The release, not the click: this window never receives the
            // press (see the roster's rows).
            onMouseUp={(event) => {
              if (event.button === 0) window.overlay.reportEvent({ type: 'cancelRequested' })
            }}
            className={[
              'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-or-fg/55 transition-colors duration-100 hover:bg-or-fg/10 hover:text-or-fg',
              trailing ? '' : 'ml-auto'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <svg
              aria-hidden
              width="8"
              height="8"
              viewBox="0 0 8 8"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M1 1l6 6M7 1L1 7" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* A side question is labelled as one, since the words are not going
          into the conversation and the user should see that they were
          heard that way. */}
      {state.aside && wide ? (
        <div className="text-[9px] leading-normal tracking-wide text-or-fg/50 uppercase">
          Side question
        </div>
      ) : null}

      {/* Committed words in full, the tentative tail dimmed: what two decodes
          agreed on against what the latest one proposes. Anchored at the
          bottom so a long dictation shows its newest words. */}
      {live ? (
        <div
          className="flex max-h-[4.5em] flex-col justify-end overflow-hidden text-[10px] leading-[1.5]"
          aria-live="polite"
        >
          <div>
            <span className="text-or-fg/85">{state.partial.committed}</span>
            {state.partial.tentative ? (
              <span className="text-or-fg/45">
                {state.partial.committed ? ' ' : ''}
                {state.partial.tentative}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {wide && state.transcript ? (
        <div
          className={[
            'text-[10px] leading-[1.5] text-or-fg/85 italic',
            // One line by default, with a faded right edge rather than an
            // ellipsis: a fade says "there is more" without pretending the
            // truncation is the message. The full text is in the chat pane.
            // Expanded on hover, and capped there: a long dictation would
            // otherwise run off the top of the window.
            hovered ? 'or-scroll max-h-[120px]' : 'overflow-hidden whitespace-nowrap'
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

      {/* The answer is read, not glanced at: full width, wrapped, no fade.
          Capped and scrolled, since the window has a fixed height and a long
          answer used to be cut off at its top edge. */}
      {answered && state.answer ? (
        <div className="or-scroll max-h-[200px] pr-1 text-[10.5px] leading-[1.45] text-or-fg">
          {state.answer}
        </div>
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
      {state.message && !bareError ? (
        <div className="text-[10px] leading-normal text-or-fg/70">{state.message}</div>
      ) : null}
    </div>
  )
}
