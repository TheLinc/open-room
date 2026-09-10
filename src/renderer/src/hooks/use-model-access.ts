import { useEffect, useState } from 'react'
import type { ModelAccess } from '@shared/model-access'

/**
 * Which models the signed-in account can use.
 *
 * Pulled on mount as well as subscribed to, like quota and login: the probe
 * runs at launch, before any window has loaded, so the broadcast that
 * carried its answer was dropped. Unknown until then, which allows every
 * model — a picker must never disable something on the strength of a check
 * that has not run.
 */
export function useModelAccess(): ModelAccess {
  const [access, setAccess] = useState<ModelAccess>({ state: 'unknown' })

  useEffect(() => {
    void window.openRoom.getModelAccess().then(setAccess)
    return window.openRoom.onModelAccessChanged(setAccess)
  }, [])

  return access
}
