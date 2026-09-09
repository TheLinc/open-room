import { describe, expect, it, vi } from 'vitest'
import { UpdateInstaller, type UpdaterLike } from './update-install'

/**
 * A stand-in for electron-updater's `autoUpdater`: the same three calls and
 * three events the installer uses, with the events fired by the test.
 */
function fakeUpdater(options: { available?: boolean; version?: string } = {}) {
  const listeners = new Map<string, (payload: unknown) => void>()
  const updater: UpdaterLike = {
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: options.available ?? true,
      updateInfo: { version: options.version ?? '0.2.0' }
    })),
    downloadUpdate: vi.fn(async () => {
      listeners.get('download-progress')?.({ percent: 50 })
      listeners.get('update-downloaded')?.({ version: options.version ?? '0.2.0' })
      return []
    }),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener)
      return updater
    }) as UpdaterLike['on']
  }
  return { updater, fire: (event: string, payload: unknown) => listeners.get(event)?.(payload) }
}

function harness(updater: UpdaterLike | null, busy = 0) {
  const onPhase = vi.fn()
  const prepareQuit = vi.fn(async () => {})
  const installer = new UpdateInstaller({
    updater,
    onPhase,
    busyAgents: () => busy,
    prepareQuit
  })
  return { installer, onPhase, prepareQuit }
}

describe('UpdateInstaller', () => {
  it('is unsupported without an updater, and says so on download', async () => {
    const { installer } = harness(null)
    expect(installer.phase).toEqual({ kind: 'unsupported' })
    const result = await installer.download()
    expect(result.ok).toBe(false)
  })

  it('checks, downloads, reports progress, and ends ready', async () => {
    const { updater } = fakeUpdater()
    const { installer, onPhase } = harness(updater)

    const result = await installer.download()

    expect(result).toEqual({ ok: true })
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    const phases = onPhase.mock.calls.map(([phase]) => phase)
    expect(phases).toEqual([
      { kind: 'downloading', percent: 0 },
      { kind: 'downloading', percent: 50 },
      { kind: 'ready', version: '0.2.0' }
    ])
    expect(installer.phase).toEqual({ kind: 'ready', version: '0.2.0' })
  })

  it('fails when the feed has no installer for a newer version', async () => {
    // The releases API found a newer tag, but its latest.yml is missing —
    // every release before this feature shipped is like that.
    const { updater } = fakeUpdater({ available: false })
    const { installer } = harness(updater)
    await installer.download()
    expect(installer.phase).toMatchObject({ kind: 'failed' })
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('fails with the error text when the download throws', async () => {
    const { updater } = fakeUpdater()
    vi.mocked(updater.downloadUpdate).mockRejectedValueOnce(
      new Error('net::ERR_INTERNET_DISCONNECTED')
    )
    const { installer } = harness(updater)
    await installer.download()
    expect(installer.phase).toEqual({
      kind: 'failed',
      message: 'net::ERR_INTERNET_DISCONNECTED'
    })
  })

  it('keeps only the first line of a long error', async () => {
    // Measured on the packaged app: electron-updater's HttpError carries the
    // response headers and a stack trace in its message, and the banner
    // rendered all of it under the button.
    const { updater } = fakeUpdater()
    vi.mocked(updater.checkForUpdates).mockRejectedValueOnce(
      new Error('HttpError: 500 \n"method: GET url: x"\nHeaders: {\n  "server": "github.com"\n}')
    )
    const { installer } = harness(updater)
    await installer.download()
    expect(installer.phase).toEqual({ kind: 'failed', message: 'HttpError: 500' })
  })

  it('names a missing feed as an unpublished installer', async () => {
    // A release from before the feed existed: electron-updater's check
    // throws rather than reporting no update.
    const { updater } = fakeUpdater()
    vi.mocked(updater.checkForUpdates).mockRejectedValueOnce(
      new Error(
        'Cannot find latest.yml in the latest release artifacts (https://github.com/TheLinc/open-room/releases/download/v0.1.1/latest.yml): HttpError: 404 \n"method: GET"'
      )
    )
    const { installer } = harness(updater)
    await installer.download()
    expect(installer.phase).toEqual({
      kind: 'failed',
      message: 'No installer is published for this release yet'
    })
  })

  it('ignores a second download while one is running', async () => {
    const { updater } = fakeUpdater()
    let release!: () => void
    vi.mocked(updater.downloadUpdate).mockImplementationOnce(
      () => new Promise<string[]>((resolve) => (release = () => resolve([])))
    )
    const { installer } = harness(updater)
    const first = installer.download()
    const second = await installer.download()
    expect(second).toEqual({ ok: true })
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    release()
    await first
  })

  it('refuses to install before anything is downloaded', async () => {
    const { updater } = fakeUpdater()
    const { installer } = harness(updater)
    const result = await installer.install()
    expect(result.ok).toBe(false)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('refuses to install while agents are working, and says how many', async () => {
    // Every agent is a CLI subprocess mid-turn; restarting under it would
    // lose the turn.
    const { updater } = fakeUpdater()
    const { installer } = harness(updater, 2)
    await installer.download()
    const result = await installer.install()
    expect(result).toEqual({
      ok: false,
      message: '2 agents are still working. Stop them or wait, then restart.'
    })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('tears the app down before handing over to the installer', async () => {
    const { updater } = fakeUpdater()
    const { installer, prepareQuit } = harness(updater)
    await installer.download()
    const order: string[] = []
    prepareQuit.mockImplementationOnce(async () => {
      order.push('prepare')
    })
    vi.mocked(updater.quitAndInstall).mockImplementationOnce(() => {
      order.push('install')
    })

    const result = await installer.install()

    expect(result).toEqual({ ok: true })
    expect(order).toEqual(['prepare', 'install'])
  })
})
