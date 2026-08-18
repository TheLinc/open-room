import type { PipEntry } from '@shared/voice-input'

/**
 * The collapsed HUD: one dot per working agent.
 *
 * Pure CSS animation, no JS. This sits on screen for minutes at a time over
 * whatever the user is actually doing, so nothing here may cost a frame on the
 * main thread — the breathing is a compositor-only transform and opacity.
 *
 * Colour answers "which agent" and only that. State is carried by rhythm: a
 * blocked agent breathes faster and grows a ring, which reads at 9px where a
 * colour change would just look like a different agent.
 */
export function PipCluster({ pips }: { pips: PipEntry[] }): React.JSX.Element {
  return (
    <div className="or-surface or-enter flex items-center gap-[7px] rounded-full px-[11px] py-[7px]">
      {pips.map((pip) => (
        <span
          key={pip.agentId}
          aria-hidden
          className={pip.state === 'needs-attention' ? 'or-pip or-pip-attn' : 'or-pip'}
          style={{
            background: pip.color,
            boxShadow: `0 0 8px ${pip.color}`,
            ['--or-pip-color' as string]: pip.color
          }}
        />
      ))}
    </div>
  )
}
