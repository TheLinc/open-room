import { useEffect, useState } from 'react'
import { ArrowUpCircle, Loader2, X } from 'lucide-react'
import type { UpdateSnapshot } from '@shared/updates'
import { describeUpdate, updateAction } from '@shared/updates'
import { Button } from '@/components/ui/button'

/**
 * A newer Open Room is on the releases page.
 *
 * App-level like the quota banner: it is about the install, not any agent.
 * On Windows, Download fetches the installer inside the app and the button
 * becomes "Restart to update"; elsewhere, and in development, Download opens
 * the release page in the browser. `updateAction` decides which.
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
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>({
    status: { state: 'unchecked' },
    install: { kind: 'unsupported' }
  })
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  // Why the last click did nothing: a refused restart names the agents that
  // are still working.
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    // Pulled as well as pushed: the check runs on a schedule in main, and a
    // window opened after the last one would otherwise wait for the next.
    void window.openRoom.getUpdate().then(setSnapshot)
    return window.openRoom.onUpdateChanged(setSnapshot)
  }, [])

  const { status } = snapshot
  const text = describeUpdate(status)
  const action = updateAction(snapshot)
  if (!text || !action || status.state !== 'available') return null
  // A downloaded installer is worth more than a dismissal: the restart
  // button stays until it is used.
  if (dismissed === status.release.version && snapshot.install.kind !== 'ready') return null

  const dismiss = (): void => {
    writeDismissed(status.release.version)
    setDismissed(status.release.version)
  }

  const act = async (): Promise<void> => {
    setRefusal(null)
    if (action.kind === 'open-page') return window.openRoom.openUpdatePage()
    if (action.kind === 'download') {
      const result = await window.openRoom.downloadUpdate()
      if (!result.ok) setRefusal(result.message)
      return
    }
    if (action.kind === 'restart') {
      const result = await window.openRoom.installUpdate()
      if (!result.ok) setRefusal(result.message)
    }
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
