import { useEffect, useState } from 'react'
import type { LoginSnapshot } from '@shared/login'

/**
 * The Claude Code logins agents can run on: the host's and one per WSL
 * distro some agent uses.
 *
 * Pulled on mount as well as subscribed to, like quota and model access:
 * the check runs at launch, before any window has loaded, so the broadcast
 * that carried its answer was dropped. Signed in until the first answer
 * arrives, so a window never opens on the first-run screen and then takes
 * it back.
 */
export function useLogin(): LoginSnapshot {
  const [login, setLogin] = useState<LoginSnapshot>({ host: { state: 'signed-in' }, wsl: {} })

  useEffect(() => {
    void window.openRoom.getLogin().then(setLogin)
    return window.openRoom.onLoginChanged(setLogin)
  }, [])

  return login
}
