import type { MutationResult } from '@shared/ipc'
import type { UpdateInstall } from '@shared/updates'

/**
 * Installs the offered release from inside the app, through electron-updater.
 *
 * Windows only, and only in a packaged build: electron-updater's docs are
 * blunt that macOS auto-update needs a signed app, and this one is unsigned.
 * Main hands in `autoUpdater` on Windows and null elsewhere, and the banner
 * offers the release page instead where it is null.
 *
 * Discovery stays with `UpdateChecker`, which reads the releases API and
 * works for every release. electron-updater reads a `latest.yml` attached to
 * the release, which only exists from the first release built after this
 * feature — so "Download" checks the feed at click time, and a release with
 * no feed fails over to the page rather than to silence.
 */

/** The slice of electron-updater's `autoUpdater` this uses, so tests can stand one in. */
export type UpdaterLike = {
  checkForUpdates: () => Promise<{
    isUpdateAvailable: boolean
    updateInfo: { version: string }
  } | null>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
  on: {
    (event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
    (event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
    (event: 'error', listener: (error: Error) => void): unknown
  }
}

const NO_FEED = 'No installer is published for this release yet'

/**
 * One line for the banner.
 *
 * Measured on the packaged app: electron-updater's HttpError carries the
 * response headers and a stack trace in its message, and a release from
 * before the feed existed fails its check with "Cannot find latest.yml"
 * rather than reporting no update.
 */
function failureLine(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim()
  if (message.startsWith('Cannot find latest.yml')) return NO_FEED
  return message.split('\n')[0].trim()
}

export class UpdateInstaller {
  phase: UpdateInstall

  constructor(
    private readonly deps: {
      updater: UpdaterLike | null
      onPhase: (phase: UpdateInstall) => void
      /** Agents mid-turn. Restarting under one loses the turn, so install waits. */
      busyAgents: () => number
      /** Ends every agent session and marks the app as quitting. */
      prepareQuit: () => Promise<void>
    }
  ) {
    this.phase = deps.updater ? { kind: 'idle' } : { kind: 'unsupported' }
    deps.updater?.on('download-progress', (progress) => {
      if (this.isDownloading()) {
        this.setPhase({ kind: 'downloading', percent: progress.percent })
      }
    })
    deps.updater?.on('update-downloaded', (info) => {
      this.setPhase({ kind: 'ready', version: info.version })
    })
    deps.updater?.on('error', (error) => {
      if (this.isDownloading()) this.fail(error)
    })
  }

  /** Checks the update feed and downloads the installer. One at a time. */
  async download(): Promise<MutationResult> {
    const updater = this.deps.updater
    if (!updater) return { ok: false, message: 'Installing from the app is not supported here' }
    if (this.phase.kind === 'downloading') return { ok: true }

    this.setPhase({ kind: 'downloading', percent: 0 })
    try {
      const check = await updater.checkForUpdates()
      if (!check?.isUpdateAvailable) {
        this.setPhase({ kind: 'failed', message: NO_FEED })
        return { ok: true }
      }
      await updater.downloadUpdate()
      // The event normally lands first; this covers a download that resolves
      // without it, so the button never sticks at 100%.
      if (this.isDownloading()) {
        this.setPhase({ kind: 'ready', version: check.updateInfo.version })
      }
      return { ok: true }
    } catch (error) {
      this.fail(error)
      return { ok: true }
    }
  }

  /**
   * Hands over to the installer and quits.
   *
   * Refused while any agent is mid-turn: every agent is a CLI subprocess,
   * and the user should decide whether to stop it, not lose it. The teardown
   * runs before `quitAndInstall` so the installer never finds the app's
   * files still open.
   */
  async install(): Promise<MutationResult> {
    if (this.phase.kind !== 'ready' || !this.deps.updater) {
      return { ok: false, message: 'No update has been downloaded' }
    }
    const busy = this.deps.busyAgents()
    if (busy > 0) {
      const noun = busy === 1 ? 'agent is' : 'agents are'
      return {
        ok: false,
        message: `${busy} ${noun} still working. Stop them or wait, then restart.`
      }
    }
    await this.deps.prepareQuit()
    this.deps.updater.quitAndInstall()
    return { ok: true }
  }

  /**
   * Read through a method: the event listeners change `phase` while
   * `download()` is awaiting, and TypeScript's narrowing of a property does
   * not know that.
   */
  private isDownloading(): boolean {
    return this.phase.kind === 'downloading'
  }

  private fail(error: unknown): void {
    this.setPhase({ kind: 'failed', message: failureLine(error) })
  }

  private setPhase(phase: UpdateInstall): void {
    this.phase = phase
    this.deps.onPhase(phase)
  }
}
