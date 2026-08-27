import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Where the SDK's own `claude` binary lives.
 *
 * The SDK ships the CLI as a platform-specific optional dependency and spawns
 * it by default, resolving it relative to its own module. In a packaged app
 * that module sits inside `app.asar`, and so does the path it resolves — but
 * a binary cannot be executed from within an archive. electron-builder
 * unpacks the package beside the asar; this points every `query()` at that
 * copy. Measured before the fix: the login check (which already rewrote the
 * path) reported signed-in while every agent failed with "exists but failed
 * to launch".
 */
export function bundledClaudePath(): string | null {
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
  try {
    const manifest = outsideAsar(require.resolve(`${pkg}/package.json`))
    const bin = join(dirname(manifest), process.platform === 'win32' ? 'claude.exe' : 'claude')
    return existsSync(bin) ? bin : null
  } catch {
    return null
  }
}

/** The unpacked twin of a path inside `app.asar`; anything else unchanged. */
export function outsideAsar(path: string): string {
  return path.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
}
