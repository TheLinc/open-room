import { useEffect, useState } from 'react'
import type { RateLimitStatus } from '@shared/agent-runtime'

/**
 * Account-wide subscription quota, as main last reported it.
 *
 * Pulled as well as pushed: the event arrives with an agent's turn, so a
 * window opened afterwards would show nothing until the next one ran. Main
 * clears it to null on its own when the window's reset time passes.
 */
export function useQuota(): RateLimitStatus | null {
  const [limit, setLimit] = useState<RateLimitStatus | null>(null)

  useEffect(() => {
    void window.openRoom.getQuota().then(setLimit)
    return window.openRoom.onQuotaChanged(setLimit)
  }, [])

  return limit
}
