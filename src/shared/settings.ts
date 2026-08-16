import { z } from 'zod'

/**
 * App-wide settings, stored at `~/.open-room/settings.json`.
 *
 * Deliberately small. Anything that belongs to one agent lives in that
 * agent's config.json instead.
 */
export const appSettingsSchema = z.object({
  /**
   * Each running agent is a full `claude` CLI subprocess, so this is a memory
   * ceiling as much as a usage one — several idle sessions is gigabytes.
   */
  maxConcurrentAgents: z.number().int().min(1).max(12).default(3),
  /** Sessions idle longer than this are torn down. 0 disables reaping. */
  idleTimeoutMinutes: z.number().int().min(0).max(240).default(30)
})

export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({})
