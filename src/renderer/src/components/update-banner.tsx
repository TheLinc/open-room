import { useEffect, useState } from 'react'
import { ArrowUpCircle, X } from 'lucide-react'
import type { UpdateStatus } from '@shared/updates'
import { describeUpdate } from '@shared/updates'
import { Button } from '@/components/ui/button'

/**
 * A newer Open Room is on the releases page.
 *
 * App-level like the quota banner: it is about the install, not any agent.
 * Download opens the release page in the browser — installing from inside
 * the app is not built yet, and on macOS cannot be until the app is signed.
 *
 * "Later" hides this version's banner and remembers that in localStorage, so
 * a restart does not bring it back. It is display state and nothing reads it
 * but this component; the tray menu keeps offering the update regardless,
 * which is what makes hiding the banner safe.
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
  const [status, setStatus] = useState<UpdateStatus>({ state: 'unchecked' })
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)

  useEffect(() => {
    // Pulled as well as pushed: the check runs on a schedule in main, and a
    // window opened after the last one would otherwise wait for the next.
    void window.openRoom.getUpdate().then(setStatus)
    return window.openRoom.onUpdateChanged(setStatus)
  }, [])

  const text = describeUpdate(status)
  if (!text || status.state !== 'available') return null
  if (dismissed === status.release.version) return null

  const dismiss = (): void => {
    writeDismissed(status.release.version)
    setDismissed(status.release.version)
  }

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-sky-500/25 bg-sky-500/5 px-6 py-1.5 text-xs text-sky-300"
    >
      <ArrowUpCircle className="size-3.5 shrink-0" />
      <span className="flex-1">{text}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={() => void window.openRoom.openUpdatePage()}
      >
        Download
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
  )
}
