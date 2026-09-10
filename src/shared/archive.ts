import type { Conversation } from './conversation'

/**
 * Archiving a conversation, and when an archived one is deleted.
 *
 * Deleting a conversation is final, and deciding that for each of a dozen
 * finished threads is why nobody tidies the switcher. Archiving takes the
 * conversation out of the list without that decision: it stays on disk,
 * shows under a collapsed group with a countdown, and can be restored until
 * the retention window (`archiveRetentionDays`, 0 for never) runs out. The
 * sweeper then deletes it by the same route as a manual delete.
 *
 * Every decision is here so it can be tested with a fixed clock; main only
 * reads and writes the record and runs the timer.
 */

export type ArchiveRecord = { archivedAt: number }
/** Session id to record, stored at `~/.open-room/agents/<id>/archive.json`. */
export type ArchiveMap = Record<string, ArchiveRecord>

const DAY_MS = 86_400_000

/** True once the window has fully passed. Never at a retention of zero. */
export function deletionDue(record: ArchiveRecord, retentionDays: number, now: number): boolean {
  if (retentionDays <= 0) return false
  return now - record.archivedAt >= retentionDays * DAY_MS
}

/** The sessions a sweep should delete now. */
export function sweepDue(archive: ArchiveMap, retentionDays: number, now: number): string[] {
  return Object.entries(archive)
    .filter(([, record]) => deletionDue(record, retentionDays, now))
    .map(([sessionId]) => sessionId)
}

/** The countdown an archived row shows. */
export function describeDeletion(
  record: ArchiveRecord,
  retentionDays: number,
  now: number
): string {
  if (retentionDays <= 0) return 'Kept until you delete it'
  const remaining = record.archivedAt + retentionDays * DAY_MS - now
  // Rounded up: archived a minute ago under a 30-day window reads "30 days",
  // not "29". Under a day left is "today" rather than a rounded-up "1 day".
  if (remaining < DAY_MS) return 'Deletes today'
  const days = Math.ceil(remaining / DAY_MS)
  return `Deletes in ${days} day${days === 1 ? '' : 's'}`
}

/** The switcher's two lists: live ones as listed, archived by archive time. */
export function partitionArchived(conversations: Conversation[]): {
  active: Conversation[]
  archived: Conversation[]
} {
  const active = conversations.filter((c) => c.archivedAt === undefined)
  const archived = conversations
    .filter((c) => c.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  return { active, archived }
}

/**
 * The conversation an agent lands in when nothing has been chosen: the most
 * recent one that is not archived. Archiving is the user saying "not this
 * one", so the launch-time resume must never pick it back up.
 */
export function latestActive(conversations: Conversation[]): string | null {
  return conversations.find((c) => c.archivedAt === undefined)?.sessionId ?? null
}
