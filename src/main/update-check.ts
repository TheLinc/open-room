import { RELEASES_URL, updateStatusFrom, type UpdateStatus } from '@shared/updates'

/**
 * Asks GitHub whether a newer Open Room has been released.
 *
 * This is the one request the app makes to a server that is not Anthropic's.
 * It carries the app's name and version in the User-Agent and nothing else;
 * GitHub sees an IP address. The README says so, and the setting that turns
 * it off is on the same page as the ones for the microphone.
 *
 * Scheduled rather than one-shot: the app is tray-resident and runs for days,
 * so a launch-time check alone would go stale. The launch itself is left
 * alone — the first check waits until the window, the sidecar and the login
 * check have had their turn.
 */

export const UPDATE_CHECK_DELAY_MS = 15_000
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
export const UPDATE_CHECK_TIMEOUT_MS = 10_000

/**
 * The slice of `fetch` this needs, so tests can hand in a stub and main can
 * hand in Electron's `net.fetch`, which honours the system proxy where Node's
 * own does not.
 */
export type ReleasesFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** One request. Never throws: anything that goes wrong is a `failed` status. */
export async function checkForUpdate(
  current: string,
  fetchImpl: ReleasesFetch,
  now: () => number = Date.now
): Promise<UpdateStatus> {
  try {
    const response = await fetchImpl(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `open-room/${current}`
      },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS)
    })
    if (!response.ok) {
      return { state: 'failed', message: `GitHub answered ${response.status}`, checkedAt: now() }
    }
    return updateStatusFrom(current, await response.json(), now())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { state: 'failed', message, checkedAt: now() }
  }
}

export class UpdateChecker {
  status: UpdateStatus = { state: 'unchecked' }

  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<UpdateStatus> | null = null

  constructor(
    private readonly deps: {
      current: string
      fetch: ReleasesFetch
      onStatus: (status: UpdateStatus) => void
      now?: () => number
    }
  ) {}

  /**
   * Starts the schedule, or stops it and forgets the last result. Off means
   * off: a banner still showing the result of a check the user has just
   * disabled would say the switch did nothing.
   */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.timer) return
      this.timer = setTimeout(() => {
        void this.checkNow()
        this.timer = setInterval(() => void this.checkNow(), UPDATE_CHECK_INTERVAL_MS)
        this.timer.unref?.()
      }, UPDATE_CHECK_DELAY_MS)
      this.timer.unref?.()
      return
    }
    this.stop()
    this.publish({ state: 'unchecked' })
  }

  /** An explicit request, whatever the schedule says. One at a time. */
  checkNow(): Promise<UpdateStatus> {
    if (this.inFlight) return this.inFlight
    this.inFlight = checkForUpdate(this.deps.current, this.deps.fetch, this.deps.now)
      .then((status) => {
        this.publish(status)
        return status
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  stop(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    clearInterval(this.timer)
    this.timer = null
  }

  private publish(status: UpdateStatus): void {
    this.status = status
    this.deps.onStatus(status)
  }
}
