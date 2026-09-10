import { describe, expect, it } from 'vitest'
import { appSettingsSchema } from './settings'

describe('appSettingsSchema', () => {
  it('keeps archived conversations for 30 days by default', () => {
    expect(appSettingsSchema.parse({}).archiveRetentionDays).toBe(30)
  })

  it('accepts never (0) and refuses more than a year', () => {
    expect(appSettingsSchema.parse({ archiveRetentionDays: 0 }).archiveRetentionDays).toBe(0)
    expect(appSettingsSchema.safeParse({ archiveRetentionDays: 400 }).success).toBe(false)
    expect(appSettingsSchema.safeParse({ archiveRetentionDays: 1.5 }).success).toBe(false)
  })
})
