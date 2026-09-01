import type { PipEntry } from '@shared/voice-input'
import { useHitBox } from '../use-hit-box'
import { PipCluster } from './pip-cluster'
import { Roster } from './roster'

/**
 * The working HUD, collapsed to dots and expanded on hover.
 *
 * Both forms occupy the same grid cell and cross-fade, so expanding is a
 * transform and an opacity and never a layout. The window has fixed bounds and
 * cannot be resized smoothly on Windows, so everything grows inside it.
 *
 * Hover comes from main hit-testing the real cursor — see `useHitBox`. The
 * measured element is whichever form is currently showing, so hovering the
 * cluster grows the target to the roster and the pointer stays inside it.
 */
export function Hud({ pips }: { pips: PipEntry[] }): React.JSX.Element {
  const { ref, hovered } = useHitBox(true)

  return (
    <div className="grid items-end justify-items-center">
      <div
        ref={hovered ? undefined : ref}
        className={[
          'col-start-1 row-start-1 origin-bottom transition-[opacity,transform] duration-150 ease-out',
          hovered ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        ].join(' ')}
      >
        <PipCluster pips={pips} />
      </div>

      <div
        ref={hovered ? ref : undefined}
        className={[
          'col-start-1 row-start-1 origin-bottom transition-[opacity,transform] duration-150 ease-out',
          hovered ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
        ].join(' ')}
      >
        <Roster
          pips={pips}
          onSelect={(agentId) => window.overlay.selectAgent(agentId)}
          onRespond={(requestId, decision) =>
            void window.overlay.respondPermission(requestId, decision)
          }
        />
      </div>
    </div>
  )
}
