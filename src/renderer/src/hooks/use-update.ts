import { useEffect, useState } from 'react'
import type { UpdateAction, UpdateSnapshot } from '@shared/updates'
import { updateAction } from '@shared/updates'

/**
 * The update's state and the one action it offers, shared by the banner
 * and the Updates page so the two never disagree about what the button
 * says or does.
 *
 * Pulled on mount as well as subscribed to: the check runs on a schedule
 * in main, and a window opened after the last one would otherwise wait for
 * the next. `refusal` is why the last click did nothing, which for a
 * restart names the agents still working.
 */
export function useUpdate(): {
  snapshot: UpdateSnapshot
  action: UpdateAction | null
  refusal: string | null
  act: () => Promise<void>
  recheck: () => Promise<UpdateSnapshot>
} {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>({
    status: { state: 'unchecked' },
    install: { kind: 'unsupported' }
  })
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    void window.openRoom.getUpdate().then(setSnapshot)
    return window.openRoom.onUpdateChanged(setSnapshot)
  }, [])

  const action = updateAction(snapshot)

  const act = async (): Promise<void> => {
    if (!action) return
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

  const recheck = async (): Promise<UpdateSnapshot> => {
    const next = await window.openRoom.recheckUpdate()
    setSnapshot(next)
    return next
  }

  return { snapshot, action, refusal, act, recheck }
}
