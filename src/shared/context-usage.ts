/**
 * How full a conversation's context window is.
 *
 * Open Room's premise is conversations resumed over days, so the window
 * filling up is a normal event rather than an edge case — and until now the
 * only signal was an agent starting to behave badly.
 *
 * The headline number is derived from the ordinary result message, so it
 * costs nothing per turn. The SDK's richer breakdown (per-category tokens,
 * MCP tool costs, memory files) is a `getContextUsage()` control request;
 * the one piece of it read today is the auto-compact threshold, fetched
 * once per session, which anchors the severity bands below.
 */

/** Amber: worth knowing about before starting something long. */
export const CONTEXT_WARN_FRACTION = 0.7
/** Red: compaction is imminent and worth doing deliberately. */
export const CONTEXT_HIGH_FRACTION = 0.9

/**
 * How far short of the compact point each band starts, as a fraction of the
 * window. Red at 5 points out is "the next long turn triggers it"; amber at
 * 15 is room to finish what is in flight and compact deliberately.
 */
export const CONTEXT_WARN_MARGIN = 0.15
export const CONTEXT_HIGH_MARGIN = 0.05

/**
 * What the session reported about auto-compaction, read once per session
 * from `getContextUsage()`. `thresholdTokens` is absolute — measured on a
 * real session it was 167000 against a 200000 window, not a fraction.
 */
export type AutoCompact = {
  enabled: boolean
  thresholdTokens: number | null
}

export type ContextUsage = {
  /** Tokens the last request's prompt occupied. */
  usedTokens: number
  windowTokens: number
  /** 0–1, and deliberately not clamped above: over-limit is real. */
  fraction: number
}

type RawUsage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

type RawModelUsage = Record<string, { contextWindow?: number } | undefined>

/**
 * The prompt size of the most recent request.
 *
 * Measured rather than assumed: `usage` on a result is per-request and equals
 * the last assistant message's usage exactly, while `modelUsage` is
 * cumulative across the session — 74,901 cached tokens against a 37,475
 * request. Summing the wrong one grows without bound and reads as a window
 * filling up twice as fast as it is.
 *
 * Cache reads dominate the total once a conversation is warm, so leaving them
 * out reports a nearly empty window for a nearly full one.
 */
export function promptTokens(usage: RawUsage | null | undefined): number {
  if (!usage) return 0
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  )
}

/**
 * Window size for the model that ran the turn.
 *
 * `modelUsage` is keyed by model and can carry more than one entry — subagent
 * and internal calls land here too — so the agent's own model is preferred
 * and the largest window is the fallback rather than whichever key enumerates
 * first.
 */
export function contextWindowFor(
  modelUsage: RawModelUsage | null | undefined,
  preferredModel?: string
): number {
  if (!modelUsage) return 0

  const preferred = preferredModel ? modelUsage[preferredModel]?.contextWindow : undefined
  if (preferred && preferred > 0) return preferred

  const windows = Object.values(modelUsage)
    .map((entry) => entry?.contextWindow ?? 0)
    .filter((size) => size > 0)

  return windows.length > 0 ? Math.max(...windows) : 0
}

/** Null when the result carries nothing to measure against. */
export function contextUsageFrom(
  usage: RawUsage | null | undefined,
  modelUsage: RawModelUsage | null | undefined,
  preferredModel?: string
): ContextUsage | null {
  const windowTokens = contextWindowFor(modelUsage, preferredModel)
  if (windowTokens <= 0) return null

  const usedTokens = promptTokens(usage)
  if (usedTokens <= 0) return null

  return { usedTokens, windowTokens, fraction: usedTokens / windowTokens }
}

export type ContextSeverity = 'ok' | 'warn' | 'high'

/**
 * Where this session's window actually stops being usable, as a fraction:
 * the auto-compact point when the session reported one, the window itself
 * when compaction is off (the request fails rather than compacts), and null
 * when nothing has been reported — the legacy constants then apply.
 */
export function compactAnchor(
  usage: ContextUsage,
  autoCompact: AutoCompact | null | undefined
): number | null {
  if (!autoCompact) return null
  if (!autoCompact.enabled) return 1
  if (!autoCompact.thresholdTokens || autoCompact.thresholdTokens <= 0) return null
  if (usage.windowTokens <= 0) return null
  return autoCompact.thresholdTokens / usage.windowTokens
}

export function contextSeverity(
  usage: ContextUsage | null,
  autoCompact?: AutoCompact | null
): ContextSeverity {
  if (!usage) return 'ok'
  const anchor = compactAnchor(usage, autoCompact)
  const high = anchor === null ? CONTEXT_HIGH_FRACTION : anchor - CONTEXT_HIGH_MARGIN
  const warn = anchor === null ? CONTEXT_WARN_FRACTION : anchor - CONTEXT_WARN_MARGIN
  if (usage.fraction >= high) return 'high'
  if (usage.fraction >= warn) return 'warn'
  return 'ok'
}

/** Short enough for a pane header: "19% of 200K". */
export function describeContext(usage: ContextUsage | null): string | null {
  if (!usage) return null
  const percent = Math.round(usage.fraction * 100)
  const window =
    usage.windowTokens >= 1000
      ? `${Math.round(usage.windowTokens / 1000)}K`
      : `${usage.windowTokens}`
  return `${percent}% of ${window}`
}
