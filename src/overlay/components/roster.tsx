import type { PipEntry } from '@shared/voice-input'

/**
 * The hover expansion.
 *
 * A 9px dot is not a target you can aim at by name, so this is what makes a
 * specific agent selectable at all — and the only place the HUD says which
 * agent is which without the user having to remember a colour.
 */
export function Roster({
  pips,
  onSelect
}: {
  pips: PipEntry[]
  onSelect: (agentId: string) => void
}): React.JSX.Element {
  return (
    <div className="or-surface flex min-w-[196px] flex-col gap-0.5 rounded-xl px-2 py-2">
      {pips.map((pip) => (
        <button
          key={pip.agentId}
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
              pip.state === 'needs-attention' ? 'text-red-400' : 'text-slate-400'
            ].join(' ')}
          >
            {pip.state === 'needs-attention'
              ? 'needs permission'
              : pip.state === 'paused'
                ? 'usage limit'
                : 'working'}
          </span>
        </button>
      ))}
    </div>
  )
}
