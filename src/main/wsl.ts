import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { LoginStatus } from '@shared/login'
import {
  linuxToUnc,
  parseWslDistroList,
  wslClaudeArgv,
  wslExecArgv,
  type WslDistro
} from '@shared/wsl'
import type { GitRunner } from './git'
import { parseAuthStatus } from './login-check'
import { resolveExecutable } from './open-in-editor'
import { IGNORED_DIRECTORIES, MAX_INDEXED_FILES } from './workspace-index'

/**
 * Executes the decisions in `src/shared/wsl.ts` against `wsl.exe`.
 *
 * Every method takes the distro explicitly: an agent names its own, and a
 * machine can have several. The executor is injected so every argv is
 * pinned by a test without a distro on the machine running it.
 */

export type WslExecResult = { code: number; stdout: Buffer; stderr: string }
export type WslExec = (args: string[], timeoutMs?: number) => Promise<WslExecResult>

const DEFAULT_TIMEOUT_MS = 15_000
/** A cold distro can take several seconds to start; first calls get longer. */
const PROBE_TIMEOUT_MS = 30_000

/** `wsl.exe` on PATH, resolved the way the editor command and git are. */
export function findWsl(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync
): string | null {
  if (platform !== 'win32') return null
  return resolveExecutable('wsl', env, platform, exists)
}

/** `wsl.exe -l -v` prints UTF-16LE; most commands' output is UTF-8. */
export function decodeWslOutput(buffer: Buffer): string {
  const bom = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
  const nulls = buffer.subarray(0, Math.min(buffer.length, 64)).filter((b) => b === 0).length
  const text = bom || nulls > 4 ? buffer.toString('utf16le') : buffer.toString('utf8')
  const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text
}

export function execWsl(exe: string): WslExec {
  return (args, timeoutMs = DEFAULT_TIMEOUT_MS) =>
    new Promise((resolve) => {
      const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
      const timer = setTimeout(() => child.kill(), timeoutMs)
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ code: -1, stdout: Buffer.concat(out), stderr: error.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr })
      })
    })
}

export class WslRuntime {
  private readonly homes = new Map<string, string | null>()

  constructor(
    private readonly exe: string | null,
    private readonly run: WslExec | null
  ) {}

  static fromPath(): WslRuntime {
    const exe = findWsl()
    return new WslRuntime(exe, exe ? execWsl(exe) : null)
  }

  get available(): boolean {
    return this.exe !== null && this.run !== null
  }

  async listDistros(): Promise<WslDistro[]> {
    if (!this.run) return []
    const result = await this.run(['-l', '-v'], PROBE_TIMEOUT_MS)
    return result.code === 0 ? parseWslDistroList(decodeWslOutput(result.stdout)) : []
  }

  async pathExists(distro: string, path: string): Promise<boolean> {
    if (!this.run) return false
    const result = await this.run(wslExecArgv(distro, null, ['test', '-d', path]), PROBE_TIMEOUT_MS)
    return result.code === 0
  }

  /** `$HOME` inside the distro, cached: it does not change while the app runs. */
  async homeDir(distro: string): Promise<string | null> {
    if (!this.run) return null
    if (this.homes.has(distro)) return this.homes.get(distro) ?? null
    const result = await this.run(
      wslExecArgv(distro, null, ['sh', '-c', 'printf %s "$HOME"']),
      PROBE_TIMEOUT_MS
    )
    const home = result.code === 0 ? decodeWslOutput(result.stdout).trim() : ''
    if (!home.startsWith('/')) return null
    this.homes.set(distro, home)
    return home
  }

  /** Where the distro's CLI keeps its sessions, as a path Windows can read. */
  async configDir(distro: string): Promise<string | null> {
    const home = await this.homeDir(distro)
    return home ? linuxToUnc(distro, `${home}/.claude`) : null
  }

  /** The distro's own login, checked the way the host's is. */
  async checkLogin(distro: string): Promise<LoginStatus> {
    if (!this.run) return { state: 'unknown' }
    const result = await this.run(
      wslExecArgv(distro, null, [
        'bash',
        '-lc',
        'exec claude "$@"',
        'claude',
        'auth',
        'status',
        '--json'
      ]),
      PROBE_TIMEOUT_MS
    )
    return parseAuthStatus(decodeWslOutput(result.stdout))
  }

  /** A `GitRunner` whose every command runs inside the distro. */
  git(distro: string): GitRunner {
    return async (args, cwd) => {
      if (!this.run) return { code: -1, stdout: '', stderr: 'WSL is not available' }
      const result = await this.run(wslExecArgv(distro, cwd, ['git', ...args]))
      return { code: result.code, stdout: decodeWslOutput(result.stdout), stderr: result.stderr }
    }
  }

  /**
   * Every file under `root`, posix-relative and sorted: the `@` picker's
   * list, produced by `find` inside the distro rather than a walk over the
   * network share, with the same ignored directories and cap as the host.
   */
  async listFiles(distro: string, root: string): Promise<string[]> {
    if (!this.run) return []
    const prune: string[] = []
    for (const name of IGNORED_DIRECTORIES) {
      if (prune.length) prune.push('-o')
      prune.push('-name', name)
    }
    const result = await this.run(
      wslExecArgv(distro, root, [
        'find',
        '.',
        '(',
        ...prune,
        ')',
        '-prune',
        '-o',
        '-type',
        'f',
        '-print'
      ]),
      PROBE_TIMEOUT_MS
    )
    if (result.code !== 0) return []
    return decodeWslOutput(result.stdout)
      .split('\n')
      .filter((line) => line.startsWith('./'))
      .map((line) => line.slice(2))
      .slice(0, MAX_INDEXED_FILES)
      .sort()
  }

  /**
   * The SDK's spawn hook: same protocol over stdio, different process. The
   * SDK's `command` (the host binary) is deliberately ignored; `claude` is
   * whatever the distro's login PATH finds. `ChildProcess` satisfies the
   * SDK's `SpawnedProcess`.
   */
  spawnClaude(distro: string): NonNullable<Options['spawnClaudeCodeProcess']> {
    const exe = this.exe
    if (!exe) throw new Error('WSL is not available')
    return (options) =>
      spawn(
        exe,
        wslClaudeArgv({ distro, cwd: options.cwd ?? null, env: options.env, args: options.args }),
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, signal: options.signal }
      )
  }
}
