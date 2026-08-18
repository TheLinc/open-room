import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/settings'

/**
 * The app's settings, and the one way to change them.
 *
 * Main owns the file; this mirrors it. The mirror is updated optimistically so
 * sliders and switches stay responsive while the write round-trips — a control
 * that lags a disk write by a frame feels broken.
 */
export function useSettings(): {
  settings: AppSettings | null
  save: (next: AppSettings) => Promise<void>
  saving: boolean
  error: string | null
} {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.openRoom.getSettings().then(setSettings)
  }, [])

  // Settings also change outside this dialog — the tray's voice toggle. Left
  // unwatched, an open dialog would show the old value and write it back.
  useEffect(() => window.openRoom.onSettingsChanged(setSettings), [])

  const save = useCallback(async (next: AppSettings): Promise<void> => {
    setSaving(true)
    setError(null)
    setSettings(next)

    const result = await window.openRoom.saveSettings(next)
    if (!result.ok) setError(result.message)
    setSaving(false)
  }, [])

  return { settings, save, saving, error }
}
