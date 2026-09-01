/**
 * Running an agent's CLI inside a WSL distro.
 *
 * Open Room stays a Windows app and the Agent SDK stays in Electron main;
 * what changes is the process the SDK spawns. Every decision about how that
 * process is launched, how paths cross the boundary and what the user is
 * told lives here, pure, so it can be asserted on. `src/main/wsl.ts`
 * executes these against `wsl.exe`.
 */

export type WslConfig = { distro: string }

/** One row of `wsl.exe -l -v`. */
export type WslDistro = { name: string; isDefault: boolean; version: 1 | 2 }

/** Shown as the isolation fallback reason for a WSL agent with worktrees on. */
export const WSL_WORKTREE_REASON = 'Worktrees are not supported for WSL agents yet'

const SHARE_HOST = '\\\\wsl.localhost\\'

/** A rooted Linux path. `//x` is a UNC-looking string, not a Linux path. */
export function isLinuxAbsolutePath(path: string): boolean {
  return /^\/(?!\/)/.test(path) || path === '/'
}

/** `/home/u/x` in `Ubuntu` -> `\\wsl.localhost\Ubuntu\home\u\x`. */
export function linuxToUnc(distro: string, linuxPath: string): string {
  return SHARE_HOST + distro + linuxPath.split('/').join('\\')
}

/**
 * The Linux path behind a `\\wsl.localhost\<distro>\...` or legacy
 * `\\wsl$\<distro>\...` path, or null for anything else. The folder picker
 * hands back the UNC form when the user browses into a distro.
 */
export function uncToLinux(windowsPath: string): { distro: string; path: string } | null {
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i.exec(windowsPath.trim())
  if (!match) return null
  const rest = (match[2] ?? '').replace(/\\+$/, '')
  return { distro: match[1], path: rest === '' ? '/' : '/' + rest.split('\\').join('/') }
}

/**
 * Parses the decoded text of `wsl.exe -l -v`. Decoding is the caller's job:
 * the command prints UTF-16LE, which is a Buffer concern that does not
 * belong in shared code.
 */
export function parseWslDistroList(text: string): WslDistro[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
  const distros: WslDistro[] = []
  for (const line of lines.slice(1)) {
    const isDefault = line.startsWith('*')
    const fields = (isDefault ? line.slice(1) : line).trim().split(/\s{2,}/)
    if (fields.length < 3) continue
    const version = Number(fields[2])
    if (version !== 1 && version !== 2) continue
    distros.push({ name: fields[0], isDefault, version })
  }
  return distros
}

const BLOCKED_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR'
])

/**
 * `K=V` pairs for `/usr/bin/env`: only what the CLI itself reads. The
 * Windows environment (Path, USERPROFILE, TEMP...) must not cross; the login
 * shell inside the distro supplies the Linux equivalents. The API key is
 * blocked for the reason it is blocked on the host, and the config dirs
 * because they are Windows paths.
 */
export function wslChildEnv(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(
      ([key, value]) =>
        value !== undefined && /^(CLAUDE_|ANTHROPIC_)/.test(key) && !BLOCKED_ENV.has(key)
    )
    .map(([key, value]) => `${key}=${value}`)
    .sort()
}

/** Run `argv` inside the distro at `cwd`, with no shell of any kind. */
export function wslExecArgv(distro: string, cwd: string | null, argv: string[]): string[] {
  return ['-d', distro, ...(cwd ? ['--cd', cwd] : []), '--exec', ...argv]
}

/**
 * The argv after `wsl.exe` that launches the distro's own `claude`.
 *
 * A login shell so version managers' PATH entries are present; a fixed
 * script with every argument positional so nothing is re-quoted (wsl.exe
 * re-escapes the command line it forwards); `env` in front so the CLI's
 * variables arrive without depending on WSLENV.
 */
export function wslClaudeArgv(input: {
  distro: string
  cwd: string | null
  env: Record<string, string | undefined>
  args: string[]
}): string[] {
  return wslExecArgv(input.distro, input.cwd, [
    '/usr/bin/env',
    ...wslChildEnv(input.env),
    'bash',
    '-lc',
    'exec claude "$@"',
    'claude',
    ...input.args
  ])
}

export function wslLoginHint(distro: string): string {
  return `Claude Code inside ${distro} is not signed in. Run \`wsl -d ${distro}\`, then \`claude\`, and sign in.`
}
