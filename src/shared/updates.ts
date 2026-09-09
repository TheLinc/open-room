/**
 * Whether a newer Open Room exists, and how to talk about it.
 *
 * Agents only ever move to a newer Claude Code when Open Room ships a newer
 * SDK, so "is there an update" is a question about this app, not about the
 * `claude` on PATH — that one is used for signing in and nothing else.
 *
 * Main asks GitHub's releases API for the repository and hands the payload
 * here; every decision about what it means is pure and tested. Installing is
 * not done from inside the app yet: the release page opens in the browser.
 */

export type UpdateRelease = {
  /** Without the tag's leading `v`. */
  version: string
  /** The release page, where the installers are attached. */
  url: string
  publishedAt: string | null
}

export type UpdateStatus =
  /** Not asked yet, or the check is switched off. */
  | { state: 'unchecked' }
  | { state: 'current'; checkedAt: number }
  | { state: 'available'; release: UpdateRelease; checkedAt: number }
  /** The request or the payload failed. Says nothing about whether an update exists. */
  | { state: 'failed'; message: string; checkedAt: number }

/**
 * How far installing the offered release from inside the app has got.
 *
 * `unsupported` is macOS and development builds: electron-updater needs a
 * signed app on macOS and a packaged one anywhere, so the browser is the only
 * route there. The rest is the Windows path through electron-updater.
 */
export type UpdateInstall =
  | { kind: 'unsupported' }
  | { kind: 'idle' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'failed'; message: string }

/** What the renderer is told: the check's result, and the install's. */
export type UpdateSnapshot = { status: UpdateStatus; install: UpdateInstall }

/** The banner's one button, and an optional line under it. */
export type UpdateAction = {
  kind: 'open-page' | 'download' | 'busy' | 'restart'
  label: string
  note?: string
}

/** GitHub: `GET /repos/{owner}/{repo}/releases`. */
export const RELEASES_URL = 'https://api.github.com/repos/TheLinc/open-room/releases?per_page=10'

type Parsed = { release: number[]; pre: string[] | null }

function parseVersion(version: string): Parsed {
  const bare = version.trim().replace(/^v/i, '')
  const dash = bare.indexOf('-')
  const main = dash < 0 ? bare : bare.slice(0, dash)
  const pre = dash < 0 ? null : bare.slice(dash + 1).split('.')
  return {
    release: main.split('.').map((part) => Number.parseInt(part, 10) || 0),
    pre
  }
}

function comparePre(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    const an = Number.parseInt(a[i], 10)
    const bn = Number.parseInt(b[i], 10)
    const numeric = !Number.isNaN(an) && !Number.isNaN(bn)
    const order = numeric ? an - bn : a[i].localeCompare(b[i])
    if (order !== 0) return order
  }
  return 0
}

/**
 * Semver order for the subset the release tags use: dotted numbers with an
 * optional prerelease suffix, which sorts below the release it precedes.
 * Negative when `a` is older than `b`.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const length = Math.max(pa.release.length, pb.release.length)
  for (let i = 0; i < length; i++) {
    const order = (pa.release[i] ?? 0) - (pb.release[i] ?? 0)
    if (order !== 0) return order
  }
  if (pa.pre === null && pb.pre === null) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  return comparePre(pa.pre, pb.pre)
}

function readRelease(entry: unknown): UpdateRelease | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  if (typeof record.tag_name !== 'string' || typeof record.html_url !== 'string') return null
  // A draft is still being written; its installers may not be attached yet.
  if (record.draft === true) return null
  // Releases flagged prerelease count. Every Open Room release so far carries
  // the flag, so a check that skipped them would never fire for anyone. If a
  // real beta channel ever exists, this is the line to revisit.
  return {
    version: record.tag_name.replace(/^v/i, ''),
    url: record.html_url,
    publishedAt: typeof record.published_at === 'string' ? record.published_at : null
  }
}

/**
 * The newest release in a `/releases` payload, or null when the payload holds
 * none. The list is not trusted to be ordered — the highest version wins.
 */
export function latestRelease(payload: unknown): UpdateRelease | null {
  if (!Array.isArray(payload)) return null
  let best: UpdateRelease | null = null
  for (const entry of payload) {
    const release = readRelease(entry)
    if (!release) continue
    if (!best || compareVersions(release.version, best.version) > 0) best = release
  }
  return best
}

/**
 * What a successful request means for the running version.
 *
 * A payload with no readable release is a failed check, not "current":
 * current is a claim, and an error body supports none. A newer running
 * version — a development build ahead of the last tag — is current too.
 */
export function updateStatusFrom(
  current: string,
  payload: unknown,
  checkedAt: number
): UpdateStatus {
  const release = latestRelease(payload)
  if (!release) return { state: 'failed', message: 'No release found in the response', checkedAt }
  if (compareVersions(release.version, current) > 0)
    return { state: 'available', release, checkedAt }
  return { state: 'current', checkedAt }
}

/**
 * Whether a check result deserves a native notification.
 *
 * Once per version. The check repeats for as long as the app is resident,
 * which is days, and the main window is usually hidden — so the first sight
 * of an update should not depend on opening it, and the tenth should not
 * happen at all.
 */
export function shouldNotifyUpdate(lastNotified: string | null, status: UpdateStatus): boolean {
  if (status.state !== 'available') return false
  return status.release.version !== lastNotified
}

/** The banner's line, or null when there is nothing to say. */
export function describeUpdate(status: UpdateStatus): string | null {
  if (status.state !== 'available') return null
  return `Open Room ${status.release.version} is available`
}

/**
 * Which button the banner shows, or null while there is no update.
 *
 * A failed in-app install falls back to the release page with the reason
 * under it, rather than a dead button: every release before this feature
 * shipped has no update feed, so the fallback is the common case for a
 * while.
 */
export function updateAction(snapshot: UpdateSnapshot): UpdateAction | null {
  if (snapshot.status.state !== 'available') return null
  const install = snapshot.install
  switch (install.kind) {
    case 'unsupported':
      return { kind: 'open-page', label: 'Download' }
    case 'idle':
      return { kind: 'download', label: 'Download' }
    case 'downloading':
      return { kind: 'busy', label: `Downloading ${Math.round(install.percent)}%` }
    case 'ready':
      return { kind: 'restart', label: 'Restart to update' }
    case 'failed':
      return { kind: 'open-page', label: 'Open release page', note: install.message }
  }
}
