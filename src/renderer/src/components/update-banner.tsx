import { useState } from 'react'
import { ArrowUpCircle, Loader2, X } from 'lucide-react'
import { describeUpdate } from '@shared/updates'
import { Button } from '@/components/ui/button'
import { useUpdate } from '@/hooks/use-update'

/**
 * A newer Open Room is on the releases page.
 *
 * App-level like the quota banner: it is about the install, not any agent.
 * The button is whatever `useUpdate` says it is, the same action the
 * Updates page offers: on Windows, Download fetches the installer inside
 * the app and the button becomes "Restart to update"; elsewhere, and in
 * development, Download opens the release page in the browser.
 *
 * "Later" hides this version's banner and remembers that in localStorage, so
 * a restart does not bring it back. It is display state and nothing reads it
 * but this component; the tray menu and the Updates page keep offering the
 * update regardless, which is what makes hiding the banner safe.
 */

const DISMISSED_KEY = 'open-room:dismissed-update'

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function writeDismissed(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, version)
  } catch {
    // Nothing to do: the banner will simply come back next launch.
  }
}

export function UpdateBanner(): React.JSX.Element | null {
  const { snapshot, action, refusal, act } = useUpdate()
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)

  const { status } = snapshot
  const text = describeUpdate(status)
  if (!text || !action || status.state !== 'available') return null
  // A downloaded installer is worth more than a dismissal: the restart
  // button stays until it is used.
  if (dismissed === status.release.version && snapshot.install.kind !== 'ready') return null

  const dismiss = (): void => {
    writeDismissed(status.release.version)
    setDismissed(status.release.version)
  }

  const note = refusal ?? action.note

  return (
    <div
      role="status"
      className="border-b border-sky-500/25 bg-sky-500/5 px-6 py-1.5 text-xs text-sky-700 dark:text-sky-300"
    >
      <div className="flex items-center gap-2">
        <ArrowUpCircle className="size-3.5 shrink-0" />
        <span className="flex-1">{text}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={action.kind === 'busy'}
          onClick={() => void act()}
        >
          {action.kind === 'busy' ? <Loader2 className="size-3 animate-spin" /> : null}
          {action.label}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="Not now"
          title="Not now"
          onClick={dismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {note && <p className="mt-1 pl-5.5 text-sky-700/70 dark:text-sky-300/70">{note}</p>}
    </div>
  )
}
