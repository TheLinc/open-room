import type { TranscriptEntry } from '@shared/agent-runtime'
import { isPrompt } from '@shared/files-changed'
import { isCommandResult } from '@shared/slash-commands'
import { liveActivityLabel, pastRunLabel } from './live-activity'

/**
 * Folds a settled turn's activity behind one "Worked for 1m 35s" row.
 *
 * The pattern is T3 Code's (`MessagesTimeline.logic.ts`, `deriveTurnFolds`):
 * once a turn has settled, everything between the prompt and the turn's
 * final text message folds behind a single row, and clicking the row
 * unfolds it. What stays visible is what the user came for: their prompt,
 * the reply, the files-changed receipt, and anything that went wrong.
 *
 * Kept as a pure projection over the entry list so both the live list and
 * persisted history go through it, and so the rules are testable. This is
 * presentation, not alteration: a folded entry is not mounted, the same DOM
 * policy as the retained-entries cap, and it is one click away.
 */

export type TranscriptRow =
  | { kind: 'entry'; entry: TranscriptEntry }
  | {
      kind: 'fold'
      /** Keyed by the first hidden entry's seq, stable across re-renders. */
      key: number
      label: string
      hidden: TranscriptEntry[]
      /**
       * The run of activity at the end of a turn still running: the label
       * names the latest call and changes as the turn goes. A settled fold
       * and an earlier live run are not live.
       */
      live: boolean
    }
  /**
   * A folded result's place at the end of its turn. The row itself is
   * hidden in the fold, but what the pane hangs off a result (the
   * files-changed receipt) is the turn's outcome and belongs after the
   * reply, not where the fold sits.
   */
  | { kind: 'after'; entry: TranscriptEntry }

type Message = {
  type?: string
  subtype?: string
  is_error?: boolean
  timestamp?: string
  total_cost_usd?: number
  message?: { content?: unknown }
}

function messageOf(entry: TranscriptEntry): Message {
  return (entry.message as Message | null) ?? {}
}

/** An assistant message carrying prose, as opposed to only thinking or tools. */
function hasText(entry: TranscriptEntry): boolean {
  const message = messageOf(entry)
  if (message.type !== 'assistant') return false
  const content = message.message?.content
  if (typeof content === 'string') return content.trim().length > 0
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        (block as { type?: string; text?: string }).type === 'text' &&
        ((block as { text?: string }).text ?? '').trim().length > 0
    )
  )
}

function isResult(entry: TranscriptEntry): boolean {
  const message = messageOf(entry)
  return message.type === 'result' && !isCommandResult(message)
}

/** The moment an entry happened: main's receive stamp live, the CLI's stamp on disk. */
function timeOf(entry: TranscriptEntry): number | null {
  if (entry.receivedAt > 0) return entry.receivedAt
  const stamp = messageOf(entry).timestamp
  if (!stamp) return null
  const parsed = Date.parse(stamp)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatWorked(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

type Turn = {
  prompt: TranscriptEntry
  /** Everything after the prompt up to and excluding the result, if any. */
  body: TranscriptEntry[]
  result: TranscriptEntry | null
  /** Live: a result has arrived. History: the next prompt has. */
  settled: boolean
}

function splitTurns(entries: TranscriptEntry[], live: boolean): (Turn | TranscriptEntry)[] {
  const out: (Turn | TranscriptEntry)[] = []
  let current: Turn | null = null

  for (const entry of entries) {
    if (isPrompt(entry)) {
      if (current) {
        // History settles at the next prompt; live only at a result.
        current.settled = current.settled || !live
        out.push(current)
      }
      current = { prompt: entry, body: [], result: null, settled: false }
      continue
    }
    if (!current) {
      out.push(entry)
      continue
    }
    if (isResult(entry)) {
      current.result = entry
      current.settled = true
      out.push(current)
      current = null
      continue
    }
    current.body.push(entry)
  }
  if (current) {
    current.settled = current.settled || !live
    out.push(current)
  }
  return out
}

/**
 * `total_cost_usd` on a result is the session's running total, not the
 * turn's, so the fold shows the step from the previous result: the first
 * cut put the running total on every fold and three identical turns read
 * $0.0671, $0.0756, $0.0841. A total smaller than the previous one means
 * the session restarted and the count began again, so it is shown as is.
 */
function turnCost(total: number | null, previousTotal: number | null): number | null {
  if (total === null) return null
  if (previousTotal === null || total < previousTotal) return total
  return total - previousTotal
}

function foldTurn(turn: Turn, previousTotal: number | null): TranscriptRow[] {
  const rows: TranscriptRow[] = [{ kind: 'entry', entry: turn.prompt }]
  const message = turn.result ? messageOf(turn.result) : null
  const stopped = Boolean(turn.result?.interrupted)
  // A failure stays on screen in full: what went wrong is the point.
  const failed = Boolean(message?.is_error) && !stopped

  const finalIndex = (() => {
    for (let i = turn.body.length - 1; i >= 0; i -= 1) if (hasText(turn.body[i])) return i
    return -1
  })()
  const hidden = turn.body.filter((_, i) => i !== finalIndex)

  if (!turn.settled) return rows.concat(liveRows(turn.body))
  if (failed || hidden.length === 0) {
    for (const entry of turn.body) rows.push({ kind: 'entry', entry })
    if (turn.result) rows.push({ kind: 'entry', entry: turn.result })
    return rows
  }

  const start = timeOf(turn.prompt)
  const last = turn.result ?? turn.body[turn.body.length - 1]
  const end = timeOf(last)
  const duration = start !== null && end !== null && end >= start ? formatWorked(end - start) : null
  // The result row folds too, and the one fact from it worth keeping in
  // view is the cost. "Turn complete · 2 turns" under "Worked for 5s" said
  // the same thing twice, and the turn count is API round trips, which
  // nobody reads.
  const total =
    message && typeof message.total_cost_usd === 'number' ? message.total_cost_usd : null
  const cost = turnCost(total, previousTotal)
  const worked = stopped
    ? duration
      ? `You stopped after ${duration}`
      : 'You stopped this turn'
    : duration
      ? `Worked for ${duration}`
      : 'Worked'
  const label = cost !== null ? `${worked} · $${cost.toFixed(4)}` : worked
  if (turn.result) hidden.push(turn.result)

  // The fold sits where the first hidden entry was; the final text keeps
  // its place relative to it, so a reply that came before trailing tool
  // calls still reads before them.
  const firstHiddenIndex = turn.body.findIndex((_, i) => i !== finalIndex)
  let placed = false
  turn.body.forEach((entry, i) => {
    if (i === finalIndex) {
      rows.push({ kind: 'entry', entry })
      return
    }
    if (!placed) {
      rows.push({ kind: 'fold', key: turn.body[firstHiddenIndex].seq, label, hidden, live: false })
      placed = true
    }
  })
  if (turn.result) rows.push({ kind: 'after', entry: turn.result })
  return rows
}

/**
 * A turn still running: prose stays in place as it streams, and every run
 * of activity between one piece of prose and the next collapses into one
 * row. The trailing run is live and names the latest call; earlier runs
 * say how many steps they hold. T3 Code's `work-live` row, in Open Room's
 * shape: the row is keyed by its first entry, which is the key the settled
 * fold will use, so a row the user opened mid-turn stays open on settle.
 */
function liveRows(body: TranscriptEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let run: TranscriptEntry[] = []
  const flush = (live: boolean): void => {
    if (run.length === 0) return
    const label = live ? liveActivityLabel(run) : pastRunLabel(run)
    rows.push({ kind: 'fold', key: run[0].seq, label, hidden: run, live })
    run = []
  }
  for (const entry of body) {
    if (hasText(entry)) {
      flush(false)
      rows.push({ kind: 'entry', entry })
    } else {
      run.push(entry)
    }
  }
  flush(true)
  return rows
}

export function foldTurns(entries: TranscriptEntry[], options: { live: boolean }): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let previousTotal: number | null = null
  for (const item of splitTurns(entries, options.live)) {
    if ('prompt' in item) {
      rows.push(...foldTurn(item, previousTotal))
      const total = item.result ? messageOf(item.result).total_cost_usd : undefined
      if (typeof total === 'number') previousTotal = total
    } else rows.push({ kind: 'entry', entry: item })
  }
  return rows
}
