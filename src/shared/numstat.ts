/**
 * Lines added and removed per file, from `git diff --numstat`.
 *
 * Each line is `added<TAB>removed<TAB>path`, with `-` for both counts on a
 * binary file. The files-changed receipt shows these beside each path so a
 * turn's size reads at a glance, without expanding every diff.
 */

export type FileStat = { added: number; removed: number } | { binary: true }

/** Parsed by path, as git printed it (forward slashes, relative to the checkout). */
export function parseNumstat(text: string): Map<string, FileStat> {
  const stats = new Map<string, FileStat>()
  for (const line of text.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trimEnd())
    if (!match) continue
    const [, added, removed, path] = match
    // `--no-index` against /dev/null names the file as a rename.
    const target = path.includes(' => ') ? path.split(' => ').pop()! : path
    stats.set(
      target,
      added === '-' || removed === '-'
        ? { binary: true }
        : { added: Number(added), removed: Number(removed) }
    )
  }
  return stats
}
