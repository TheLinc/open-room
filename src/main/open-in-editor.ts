import { spawn } from 'node:child_process'
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

/** Runs the invocation, or opens with the OS default. Never throws. */
export async function openInEditor(
  command: string,
  path: string,
  line?: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invocation = editorInvocation(command, path, line)
  if (!invocation) {
    // Imported lazily: vitest runs this module in a plain Node environment,
    // where `require('electron')` resolves to the binary path string rather
    // than the API, so a top-level import would break the pure functions
    // above for every test in this file, not just this one.
    const { shell } = await import('electron')
    const error = await shell.openPath(path)
    return error ? { ok: false, message: error } : { ok: true }
  }
  return new Promise((done) => {
    // `shell: true` so `code` resolves through PATH on Windows, where it is
    // a .cmd shim rather than an executable.
    const child = spawn(invocation.file, invocation.args, {
      shell: true,
      detached: true,
      stdio: 'ignore'
    })
    child.once('error', (error) => done({ ok: false, message: error.message }))
    child.once('spawn', () => {
      child.unref()
      done({ ok: true })
    })
  })
}
