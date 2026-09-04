import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'

/**
 * Turns the CLI's suggestions for "Allow for this session" into exactly that.
 *
 * The CLI answers a permission prompt with a set of updates it would apply
 * if the user chose "don't ask again", and the app used to return the whole
 * set verbatim. Measured against the bundled CLI on `touch same.txt`, the
 * set was three updates: the rule `Bash(touch same.txt)` bound for
 * `localSettings`, an `addDirectories` grant for the cwd, and
 * `setMode: acceptEdits`. Returned as-is, one click on a Bash prompt
 * silently switched the session into accept-edits mode, and the rule was
 * written into the workspace's `.claude/settings.local.json` along with
 * `defaultMode: acceptEdits`, a file agents never read (they run with
 * `settingSources: []`) but terminal Claude Code does.
 *
 * So only the `addRules` entries survive, re-addressed to the session.
 * Measured: a rule-only session update stops the CLI asking for the same
 * command again and still asks for a different one, which is what the
 * button says.
 */
export function sessionScoped(
  suggestions: PermissionUpdate[] | undefined
): PermissionUpdate[] | undefined {
  return suggestions
    ?.filter((update) => update.type === 'addRules')
    .map((update) => ({ ...update, destination: 'session' as const }))
}
