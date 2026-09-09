import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UpdateChecker,
  checkForUpdate,
  type ReleasesFetch
} from './update-check'
import { RELEASES_URL } from '@shared/updates'

function releases(...tags: string[]): unknown {
  return tags.map((tag) => ({
    tag_name: tag,
    html_url: `https://github.com/TheLinc/open-room/releases/tag/${tag}`,
    published_at: '2026-08-28T14:16:54Z',
    draft: false,
    prerelease: true
  }))
}

function respondingWith(payload: unknown, status = 200): ReleasesFetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  }))
}

afterEach(() => vi.useRealTimers())

describe('checkForUpdate', () => {
  it('asks the releases API as this app, and offers a newer release', async () => {
    const fetch = respondingWith(releases('v0.2.0'))
    const status = await checkForUpdate('0.1.1', fetch, () => 42)

    expect(status).toEqual({
      state: 'available',
      release: {
        version: '0.2.0',
        url: 'https://github.com/TheLinc/open-room/releases/tag/v0.2.0',
        publishedAt: '2026-08-28T14:16:54Z'
      },
      checkedAt: 42
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(RELEASES_URL)
    // GitHub refuses requests with no User-Agent; naming the app is also the
    // only thing this request says about who is asking.
    expect(init.headers['User-Agent']).toBe('open-room/0.1.1')
    expect(init.headers.Accept).toBe('application/vnd.github+json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports an error status as a failed check, not as current', async () => {
    const status = await checkForUpdate('0.1.1', respondingWith({ message: 'rate limited' }, 403))
    expect(status).toMatchObject({ state: 'failed', message: expect.stringContaining('403') })
  })

  it('reports a network failure as a failed check', async () => {
    const fetch: ReleasesFetch = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    })
    const status = await checkForUpdate('0.1.1', fetch)
    expect(status).toMatchObject({ state: 'failed', message: expect.stringContaining('ENOTFOUND') })
  })
})

function harness(payload: unknown = releases('v0.2.0')) {
  const fetch = respondingWith(payload)
  const onStatus = vi.fn()
  const checker = new UpdateChecker({ current: '0.1.1', fetch, onStatus })
  return { fetch, onStatus, checker }
}

describe('UpdateChecker', () => {
  it('waits out the launch before the first check, then repeats on the interval', async () => {
    vi.useFakeTimers()
    const { fetch, onStatus, checker } = harness()

    checker.setEnabled(true)
    expect(fetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(checker.status.state).toBe('available')
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'available' }))

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not schedule twice when enabled twice', async () => {
    vi.useFakeTimers()
    const { fetch, checker } = harness()
    checker.setEnabled(true)
    checker.setEnabled(true)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS + UPDATE_CHECK_INTERVAL_MS)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops checking and forgets the result when switched off', async () => {
    vi.useFakeTimers()
    const { fetch, onStatus, checker } = harness()
    checker.setEnabled(true)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS)
    expect(checker.status.state).toBe('available')

    checker.setEnabled(false)
    // Off means off: a banner still showing a result from a check the user
    // has just disabled would say the switch did nothing.
    expect(checker.status).toEqual({ state: 'unchecked' })
    expect(onStatus).toHaveBeenLastCalledWith({ state: 'unchecked' })

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks immediately on request, whatever the schedule', async () => {
    vi.useFakeTimers()
    const { fetch, checker } = harness(releases('v0.1.1'))
    const status = await checker.checkNow()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(status.state).toBe('current')
    expect(checker.status.state).toBe('current')
  })

  it('runs one request at a time', async () => {
    vi.useFakeTimers()
    const { fetch, checker } = harness()
    const [a, b] = await Promise.all([checker.checkNow(), checker.checkNow()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })
})
