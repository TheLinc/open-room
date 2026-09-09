import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  describeUpdate,
  latestRelease,
  shouldNotifyUpdate,
  updateStatusFrom,
  type UpdateStatus
} from './updates'

function release(tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: tag,
    html_url: `https://github.com/TheLinc/open-room/releases/tag/${tag}`,
    published_at: '2026-08-28T14:16:54Z',
    draft: false,
    prerelease: true,
    ...extra
  }
}

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('treats a missing component as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.1', '1.0.5')).toBeGreaterThan(0)
  })

  it('ranks a prerelease below the release it precedes', () => {
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-beta.1', '0.1.9')).toBeGreaterThan(0)
  })

  it('ignores a leading v', () => {
    expect(compareVersions('v0.1.1', '0.1.1')).toBe(0)
  })
})

describe('latestRelease', () => {
  it('picks the highest version, not the first entry', () => {
    const picked = latestRelease([release('v0.1.0'), release('v0.2.0'), release('v0.1.1')])
    expect(picked).toEqual({
      version: '0.2.0',
      url: 'https://github.com/TheLinc/open-room/releases/tag/v0.2.0',
      publishedAt: '2026-08-28T14:16:54Z'
    })
  })

  it('skips drafts', () => {
    // A draft is being written; its installers may not be attached yet.
    const picked = latestRelease([release('v0.3.0', { draft: true }), release('v0.2.0')])
    expect(picked?.version).toBe('0.2.0')
  })

  it('counts a release flagged prerelease', () => {
    // Every Open Room release so far is flagged prerelease. A check that
    // ignored them would never fire for anyone.
    expect(latestRelease([release('v0.2.0', { prerelease: true })])?.version).toBe('0.2.0')
  })

  it('ignores entries that are not releases', () => {
    expect(latestRelease([{ tag_name: 42 }, { html_url: 'x' }, null, 'nope'])).toBeNull()
    expect(latestRelease({ message: 'API rate limit exceeded' })).toBeNull()
    expect(latestRelease([])).toBeNull()
  })

  it('leaves the published date null when absent', () => {
    expect(latestRelease([release('v0.2.0', { published_at: null })])?.publishedAt).toBeNull()
  })
})

describe('updateStatusFrom', () => {
  it('offers a newer release', () => {
    const status = updateStatusFrom('0.1.1', [release('v0.2.0')], 1000)
    expect(status).toEqual({
      state: 'available',
      release: {
        version: '0.2.0',
        url: 'https://github.com/TheLinc/open-room/releases/tag/v0.2.0',
        publishedAt: '2026-08-28T14:16:54Z'
      },
      checkedAt: 1000
    })
  })

  it('reports current when the latest is what is running', () => {
    expect(updateStatusFrom('0.1.1', [release('v0.1.1')], 1000)).toEqual({
      state: 'current',
      checkedAt: 1000
    })
  })

  it('never offers a downgrade', () => {
    // A development build is usually ahead of the last tag.
    expect(updateStatusFrom('0.3.0', [release('v0.2.0')], 1000).state).toBe('current')
  })

  it('reports an unreadable payload as a failed check, not as current', () => {
    // "Current" is a claim; a payload that could not be read supports none.
    const status = updateStatusFrom('0.1.1', { message: 'Not Found' }, 1000)
    expect(status.state).toBe('failed')
  })
})

describe('shouldNotifyUpdate', () => {
  const available: UpdateStatus = {
    state: 'available',
    release: { version: '0.2.0', url: 'https://example.invalid', publishedAt: null },
    checkedAt: 1
  }

  it('notifies the first time a version is seen', () => {
    expect(shouldNotifyUpdate(null, available)).toBe(true)
  })

  it('stays quiet on every later check that finds the same version', () => {
    // The check runs every few hours for as long as the app is resident.
    expect(shouldNotifyUpdate('0.2.0', available)).toBe(false)
  })

  it('notifies again when a newer version appears', () => {
    const newer: UpdateStatus = {
      ...available,
      release: { ...available.release, version: '0.2.1' }
    }
    expect(shouldNotifyUpdate('0.2.0', newer)).toBe(true)
  })

  it('never notifies for anything but an available update', () => {
    expect(shouldNotifyUpdate(null, { state: 'current', checkedAt: 1 })).toBe(false)
    expect(shouldNotifyUpdate(null, { state: 'failed', message: 'x', checkedAt: 1 })).toBe(false)
    expect(shouldNotifyUpdate(null, { state: 'unchecked' })).toBe(false)
  })
})

describe('describeUpdate', () => {
  it('names the version on offer', () => {
    expect(
      describeUpdate({
        state: 'available',
        release: { version: '0.2.0', url: 'https://example.invalid', publishedAt: null },
        checkedAt: 1
      })
    ).toBe('Open Room 0.2.0 is available')
  })

  it('has nothing to say otherwise', () => {
    expect(describeUpdate({ state: 'current', checkedAt: 1 })).toBeNull()
    expect(describeUpdate({ state: 'unchecked' })).toBeNull()
    expect(describeUpdate({ state: 'failed', message: 'x', checkedAt: 1 })).toBeNull()
  })
})
