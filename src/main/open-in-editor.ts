import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/**
 * Opening a path in the user's editor.
 *
 * Open Room is not an editor and does not try to be one; it hands the file
 * to whatever the user already uses. The `editorCommand` setting is a
 * template (`code -g {path}:{line}`); empty means the OS default for the
 * file type, which needs no configuration and always does something.
 */

export type EditorInvocation = { file: string; args: string[] }

/** Splits on whitespace, honouring double quotes. */
function splitCommand(command: string): string[] {
  const parts: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command))) parts.push(m[1] ?? m[2])
  return parts
}

/** The spawn for a command template, or null when the OS default should open it. */
export function editorInvocation(
  command: string,
  path: string,
  line?: number
): EditorInvocation | null {
  const parts = splitCommand(command.trim())
  if (parts.length === 0) return null
  const args = parts.slice(1).map((part) =>
    part
      .replace(/:\{line\}/g, line === undefined ? '' : `:${line}`)
      .replace(/\{line\}/g, line === undefined ? '' : String(line))
      .replace(/\{path\}/g, path)
  )
  return { file: parts[0], args }
}

/** Tool inputs are usually absolute, but a relative one is workspace-relative. */
export function resolveTarget(path: string, workspacePath: string): string {
  return isAbsolute(path) ? path : resolve(workspacePath, path)
}

/**
 * Extensions `ShellExecute`'s `open` verb *runs* rather than displays or
 * hands to an associated viewer. `shell.openPath` — the OS-default branch
 * below — goes through exactly that verb, and the path it opens comes from
 * the agent's own Write/Edit tool inputs, so this list is what stands
 * between a model writing a file and that file executing.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.ps1',
  '.vbs',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.msi',
  '.reg',
  '.scr',
  '.hta',
  '.lnk',
  '.pif',
  '.app',
  '.sh',
  '.command'
])

/** Whether opening `path` with the OS default would execute rather than view it. */
export function isExecutableTarget(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot === -1) return false
  return EXECUTABLE_EXTENSIONS.has(base.slice(dot).toLowerCase())
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

function hasPathSeparator(file: string): boolean {
  return /[/\\]/.test(file)
}

function hasExtension(file: string): boolean {
  const base = file.split(/[/\\]/).pop() ?? file
  return base.includes('.')
}

/**
 * Joins a directory and a name using the target platform's own separator —
 * never `node:path`'s `join`, which is bound to the *host* OS and would
 * silently produce backslash-joined paths for a simulated `darwin` PATH
 * under test on a Windows machine.
 */
function joinPath(dir: string, name: string, platform: NodeJS.Platform): string {
  const sep = platform === 'win32' ? '\\' : '/'
  const trimmed = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir
  return `${trimmed}${sep}${name}`
}

/**
 * Resolves a bare command name (or a path to one) to a concrete executable
 * path the way a shell's own lookup would, without invoking a shell.
 *
 * `file` containing a separator is treated as a path rather than a PATH
 * lookup; a bare name is walked across PATH entries. On win32, PATHEXT
 * suffixes are tried as well, since `code` on PATH is `code.cmd`, not
 * `code.exe`. Pure and side-effect free: `exists` is injected so this is
 * testable against an in-memory set rather than the real filesystem.
 */
export function resolveExecutable(
  file: string,
  env: { PATH?: string; Path?: string; PATHEXT?: string; [key: string]: string | undefined },
  platform: NodeJS.Platform,
  exists: (p: string) => boolean
): string | null {
  const isWindows = platform === 'win32'
  const pathExts = isWindows ? (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter(Boolean) : []

  if (hasPathSeparator(file)) {
    // Same reasoning as the PATH walk below: an extensionless name is only
    // ever resolved through PATHEXT on win32, never checked as a literal
    // file, since a same-directory extensionless script existing on disk
    // does not mean `spawn` can execute it directly.
    if (isWindows && !hasExtension(file)) {
      for (const ext of pathExts) {
        const candidate = file + ext
        if (exists(candidate)) return candidate
      }
      return null
    }
    return exists(file) ? file : null
  }

  const pathVar = isWindows ? (env.Path ?? env.PATH) : env.PATH
  if (!pathVar) return null
  const dirs = pathVar.split(isWindows ? ';' : ':').filter(Boolean)

  for (const dir of dirs) {
    if (isWindows && !hasExtension(file)) {
      // A bare, extensionless name is resolved by trying each PATHEXT
      // suffix, same as cmd.exe's own implicit lookup — never the literal
      // extensionless name. Directories on this machine hold both a
      // POSIX-style `code` shebang script and a `code.cmd` shim side by
      // side; a plain `exists(join(dir, file))` check would find the
      // former, which `spawn` cannot execute directly (ENOENT), and never
      // reach the working `.cmd`.
      for (const ext of pathExts) {
        const candidate = joinPath(dir, file + ext, platform)
        if (exists(candidate)) return candidate
      }
      continue
    }
    const bare = joinPath(dir, file, platform)
    if (exists(bare)) return bare
  }
  return null
}

/**
 * How long to wait for a spawned editor command to prove itself broken.
 *
 * A command that exits non-zero within this window is reported as broken;
 * one still running after it has elapsed is treated as having worked and
 * left to run on its own.
 */
const GRACE_PERIOD_MS = 1500

/**
 * The concrete `spawn` invocation for a resolved executable.
 *
 * A `.cmd`/`.bat` target must run through `cmd /d /s /c` because Node
 * refuses to spawn one directly (CVE-2024-27980); everything else spawns as
 * itself with `args` untouched. Pure so the exact quoting can be asserted
 * without spawning anything: quoting the whole argv inside one pair of
 * double quotes (`windowsVerbatimArguments: true` on the caller's side)
 * makes cmd treat `& | < > ^` as literal characters rather than operators —
 * the documented safe form, and only reachable once every argument has
 * already been checked for a quote it could use to break out of it.
 */
export function spawnPlan(
  resolved: string,
  args: string[],
  comSpec: string
): { file: string; args: string[]; verbatim: boolean } {
  if (!/\.(cmd|bat)$/i.test(resolved)) return { file: resolved, args, verbatim: false }
  return {
    file: comSpec,
    args: ['/d', '/s', '/c', `"${[resolved, ...args].map((a) => `"${a}"`).join(' ')}"`],
    verbatim: true
  }
}

/**
 * Runs the invocation, or opens with the OS default. Never throws.
 *
 * No `shell: true`: `path` (and therefore the substituted `{path}` argument)
 * comes from the agent's own tool inputs — an Edit or Write call's
 * `file_path` — so a shell would let a model-crafted path such as
 * `x.ts & calc` execute as a second command. Without a shell, Node still
 * refuses to spawn a `.cmd`/`.bat` file directly (CVE-2024-27980), which is
 * exactly what `code` is on Windows; `resolveExecutable` finds that shim
 * ahead of time and `spawnPlan` builds the one shelled-out form this ever
 * uses. Opening is not the same operation as running: the OS-default branch
 * below refuses an executable target for the same reason, since "open"
 * must never mean "run" for a path an agent chose.
 */
export async function openInEditor(
  command: string,
  path: string,
  line?: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invocation = editorInvocation(command, path, line)
  if (!invocation) {
    // Checked before importing electron: `shell.openPath` runs `ShellExecute`'s
    // `open` verb, which executes rather than displays these extensions, and
    // `path` comes from the agent's own Write/Edit tool inputs.
    if (isExecutableTarget(path)) {
      return {
        ok: false,
        message:
          'Open Room will not launch an executable file. Set an editor command under "Open files with" to open it as text.'
      }
    }
    // Imported lazily: vitest runs this module in a plain Node environment,
    // where `require('electron')` resolves to the binary path string rather
    // than the API, so a top-level import would break the pure functions
    // above for every test in this file, not just this one.
    const { shell } = await import('electron')
    const error = await shell.openPath(path)
    return error ? { ok: false, message: error } : { ok: true }
  }

  // `%` and `!` are refused alongside quotes and line breaks: cmd expands
  // `%VAR%` in its first parsing pass and `!VAR!` under delayed expansion,
  // both before quote parsing even runs, so quoting alone cannot neutralise
  // them once a `.cmd`/`.bat` target routes through cmd at all.
  if (invocation.args.some((arg) => /["\n\r%!]/.test(arg))) {
    return {
      ok: false,
      message:
        'Editor arguments may not contain quotes, percent signs, exclamation marks or line breaks.'
    }
  }

  const resolved = resolveExecutable(invocation.file, process.env, process.platform, existsSync)
  if (!resolved) {
    return {
      ok: false,
      message: `Could not find "${invocation.file}" on PATH. Check the "Open files with" setting.`
    }
  }

  return new Promise((done) => {
    const plan = spawnPlan(resolved, invocation.args, process.env.ComSpec ?? 'cmd.exe')
    const child = spawn(plan.file, plan.args, {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: plan.verbatim
    })

    let settled = false
    let timer: NodeJS.Timeout
    const finish = (result: { ok: true } | { ok: false; message: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(result)
    }

    // Still running after the grace period: the target resolved and is
    // doing its own thing. Unref so it cannot keep this process alive, and
    // let it run to completion on its own.
    timer = setTimeout(() => {
      child.unref()
      finish({ ok: true })
    }, GRACE_PERIOD_MS)

    child.once('error', (error) => finish({ ok: false, message: error.message }))

    child.once('exit', (code) => {
      if (code === 0) {
        child.unref()
        finish({ ok: true })
        return
      }
      finish({
        ok: false,
        message: `Editor command exited with code ${code}. Check the "Open files with" setting.`
      })
    })
  })
}
