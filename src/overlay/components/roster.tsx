import type { PermissionDecision } from '@shared/agent-runtime'
import type { PipEntry } from '@shared/voice-input'

/**
 * The hover expansion.
 *
 * A 9px dot is not a target you can aim at by name, so this is what makes a
 * specific agent selectable at all — and the only place the HUD says which
 * agent is which without the user having to remember a colour.
 *
 * It is also where an agent that needs you can be answered without raising
 * the window: a permission prompt gets its buttons, a spoken question gets
 * shown so a push-to-talk reply is aimed at something you can read.
 */
export function Roster({
  pips,
  onSelect,
  onRespond
}: {
  pips: PipEntry[]
  onSelect: (agentId: string) => void
  onRespond: (requestId: string, decision: PermissionDecision) => void
}): React.JSX.Element {
  const detailed = pips.some((pip) => pip.permission || pip.question)

  return (
    <div
      className={[
        'or-surface flex flex-col gap-0.5 rounded-xl px-2 py-2',
        detailed ? 'w-[340px]' : 'min-w-[196px]'
      ].join(' ')}
    >
      {pips.map((pip) => (
        <div key={pip.agentId} className="flex flex-col">
          <button
            type="button"
            // The release, not the click. This window is `focusable: false`, and
            // on Windows Chromium answers the press that would activate such a
            // window with MA_NOACTIVATEANDEAT — the mousedown is swallowed before
            // the page sees it. Measured with a real cursor: the row received
            // `mouseup` alone, so no `click` was ever synthesised and `onClick`
            // never ran. The release is delivered, so that is the gesture.
            onMouseUp={(event) => {
              if (event.button === 0) onSelect(pip.agentId)
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-100 hover:bg-white/8"
          >
            <span
              aria-hidden
              className="block size-2 shrink-0 rounded-full"
              style={{ background: pip.color, boxShadow: `0 0 9px ${pip.color}` }}
            />
            <span className="truncate text-[11px] font-semibold text-slate-100">{pip.name}</span>
            <span
              className={[
                'ml-auto shrink-0 pl-2 text-[9.5px]',
                pip.state === 'needs-attention'
                  ? 'text-red-400'
                  : pip.state === 'asking'
                    ? 'text-amber-300'
                    : 'text-slate-400'
              ].join(' ')}
            >
              {pip.state === 'needs-attention'
                ? 'needs permission'
                : pip.state === 'asking'
                  ? 'waiting for you'
                  : pip.state === 'paused'
                    ? 'usage limit'
                    : 'working'}
            </span>
          </button>

          {pip.permission && (
            <div className="flex flex-col gap-1 px-1.5 pt-0.5 pb-1.5">
              <div
                className="truncate font-mono text-[10px] text-slate-300"
                title={pip.permission.summary}
              >
                {pip.permission.summary}
              </div>
              <div className="flex gap-1">
                <Answer onMouseUp={() => onRespond(pip.permission!.id, 'allow')}>Allow once</Answer>
                {pip.permission.canRemember && (
                  <Answer onMouseUp={() => onRespond(pip.permission!.id, 'allow-always')}>
                    Allow for this session
                  </Answer>
                )}
                <Answer muted onMouseUp={() => onRespond(pip.permission!.id, 'deny')}>
                  Decline
                </Answer>
              </div>
            </div>
          )}

          {pip.question && (
            <div
              className="line-clamp-2 px-1.5 pt-0.5 pb-1.5 text-[10.5px] leading-snug text-slate-300"
              title={pip.question}
            >
              {pip.question}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** One answer to a permission prompt. Same gesture as the row: the release. */
function Answer({
  muted = false,
  onMouseUp,
  children
}: {
  muted?: boolean
  onMouseUp: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onMouseUp={(event) => {
        if (event.button === 0) onMouseUp()
      }}
      className={[
        'cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium transition-colors duration-100',
        muted
          ? 'text-slate-400 hover:bg-white/8 hover:text-slate-200'
          : 'bg-white/10 text-slate-100 hover:bg-white/16'
      ].join(' ')}
    >
      {children}
    </button>
  )
}
