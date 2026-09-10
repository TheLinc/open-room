import { sweepDue } from '@shared/archive'
import type { ArchiveReader } from './archive-store'

/**
 * Deletes archived conversations whose retention window has passed.
 *
 * Runs once shortly after launch and then hourly. The delay keeps the first
 * sweep off the launch path, where the login check, the model probe and the
 * speech warm-up already contend for the disk. Deletion goes through the
 * same `remove` as a manual delete, so a worktree with uncommitted work is
 * refused and kept exactly as it would be by hand; that failure is logged
 * and the sweep moves on, since one stuck conversation must not shield the
 * rest.
 */

export const SWEEP_DELAY_MS = 20_000
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000

export class ArchiveSweeper {
  private timer: NodeJS.Timeout | null = null
  private interval: NodeJS.Timeout | null = null
  private sweeping = false

  constructor(
    private readonly deps: {
      agents(): Promise<string[]>
      archive: ArchiveReader
      /** Read at sweep time, so a settings change applies to the next sweep. */
      retentionDays(): number
      remove(agentId: string, sessionId: string): Promise<void>
      now?: () => number
      log?: (message: string) => void
    }
  ) {}

  start(): void {
    this.stop()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.sweep()
      this.interval = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS)
      this.interval.unref?.()
    }, SWEEP_DELAY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.interval) clearInterval(this.interval)
    this.timer = null
    this.interval = null
  }

  async sweep(): Promise<void> {
    // A sweep that outlasts the interval must not overlap the next one.
    if (this.sweeping) return
    this.sweeping = true
    try {
      const now = this.deps.now?.() ?? Date.now()
      const retention = this.deps.retentionDays()
      for (const agentId of await this.deps.agents()) {
        const due = sweepDue(await this.deps.archive.read(agentId), retention, now)
        for (const sessionId of due) {
          try {
            await this.deps.remove(agentId, sessionId)
          } catch (error) {
            this.deps.log?.(
              `archive sweep kept ${agentId}/${sessionId}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }
      }
    } finally {
      this.sweeping = false
    }
  }
}
