import { describe, expect, it } from 'vitest'
import type { RateLimitStatus } from './agent-runtime'
import { describeQuota, overageBlocked, quotaSeverity, shouldNotifyQuota } from './quota'

const reached: RateLimitStatus = { status: 'rejected', rateLimitType: 'five_hour' }
const warning: RateLimitStatus = { status: 'allowed_warning', rateLimitType: 'five_hour' }
const allowed: RateLimitStatus = { status: 'allowed', rateLimitType: 'five_hour' }

describe('quotaSeverity', () => {
  it('treats an allowed heartbeat as nothing to report', () => {
    // The SDK sends one of these roughly every turn; it is not an alarm.
    expect(quotaSeverity(allowed)).toBe('none')
    expect(quotaSeverity(null)).toBe('none')
  })

  it('separates approaching from reached', () => {
    expect(quotaSeverity(warning)).toBe('warning')
    expect(quotaSeverity(reached)).toBe('reached')
  })
})

describe('describeQuota', () => {
  it('says nothing while the account is fine', () => {
    expect(describeQuota(null)).toBeNull()
    expect(describeQuota(allowed)).toBeNull()
  })

  it('names the window that was hit', () => {
    expect(describeQuota(reached)).toContain('5-hour limit')
    expect(describeQuota({ status: 'rejected', rateLimitType: 'seven_day' })).toContain(
      'weekly limit'
    )
    expect(describeQuota({ status: 'rejected', rateLimitType: 'something_new' })).toContain(
      'usage limit'
    )
  })

  it('distinguishes running on overage from being stopped by it', () => {
    // The distinction that matters: one keeps working and bills differently,
    // the other means nothing happens until the window resets.
    const onOverage = describeQuota({ ...reached, isUsingOverage: true })
    const blocked = describeQuota({ ...reached, overageStatus: 'rejected' })

    expect(onOverage).toContain('overage')
    expect(onOverage).not.toContain('paused')
    expect(blocked).toContain('paused')
  })

  it('omits the percentage when the SDK does not send one', () => {
    // `utilization` is documented but absent from real payloads. Rendering it
    // unconditionally produced an empty pair of brackets.
    expect(describeQuota(warning)).toBe('Approaching 5-hour limit')
    expect(describeQuota({ ...warning, utilization: 0.85 })).toContain('85%')
  })

  it('includes an absolute reset time when one is known', () => {
    const text = describeQuota({ ...reached, resetsAt: 1787243400 })
    expect(text).toContain('resets')
  })
})

describe('overageBlocked', () => {
  it('is true when the org has disabled it', () => {
    expect(
      overageBlocked({
        ...reached,
        overageStatus: 'rejected',
        overageDisabledReason: 'org_level_disabled_until'
      })
    ).toBe(true)
  })

  it('is false while actually running on it', () => {
    expect(overageBlocked({ ...reached, isUsingOverage: true })).toBe(false)
  })

  it('does not claim knowledge the payload lacks', () => {
    // An absent overageStatus means the payload did not say. Announcing that
    // agents are paused would be inventing it, so the copy stays neutral.
    expect(overageBlocked(reached)).toBe(false)
    expect(describeQuota(reached)).not.toContain('paused')
    expect(describeQuota(reached)).toContain('reached')
  })
})

describe('shouldNotifyQuota', () => {
  it('notifies when a healthy account first hits a warning', () => {
    expect(shouldNotifyQuota(allowed, warning)).toBe(true)
  })

  it('notifies again when a warning becomes a hard stop', () => {
    // A step up is new information even though something was already shown.
    expect(shouldNotifyQuota(warning, reached)).toBe(true)
  })

  it('stays silent while the state merely repeats', () => {
    // The event arrives about once per turn; re-notifying would be relentless.
    expect(shouldNotifyQuota(reached, reached)).toBe(false)
    expect(shouldNotifyQuota(warning, warning)).toBe(false)
  })

  it('stays silent on recovery', () => {
    expect(shouldNotifyQuota(reached, allowed)).toBe(false)
    expect(shouldNotifyQuota(warning, null)).toBe(false)
  })

  it('notifies on the very first event when nothing is known yet', () => {
    expect(shouldNotifyQuota(null, reached)).toBe(true)
    expect(shouldNotifyQuota(null, allowed)).toBe(false)
  })
})
