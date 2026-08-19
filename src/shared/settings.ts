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
  idleTimeoutMinutes: z.number().int().min(0).max(240).default(30),

  /**
   * Push-to-talk ships off.
   *
   * Not for the always-on reason — that argument lives on `wakeWordEnabled`
   * below, where it applies. This is off because it cannot work until a
   * speech model is downloaded, and because turning it on claims a global
   * hotkey; both are things to ask for rather than assume.
   */
  voiceInputEnabled: z.boolean().default(false),

  /**
   * Global push-to-talk binding, in Electron accelerator form.
   *
   * Toggle rather than hold: `globalShortcut` reports key-down only, with no
   * key-up event, so true hold-to-talk needs a native key hook the sidecar
   * will provide later.
   */
  pushToTalkHotkey: z.string().default('CommandOrControl+Shift+Space'),

  /**
   * Wake words ship off, and this is the flag the open-microphone argument
   * actually belongs to.
   *
   * Push-to-talk opens the microphone only when someone at the keyboard
   * presses a key they chose. This keeps it open. That is an unauthenticated
   * control channel into a tool with shell and file-write access — anyone
   * within earshot, or a video playing nearby, can address an agent.
   */
  wakeWordEnabled: z.boolean().default(false)
})

export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({})
