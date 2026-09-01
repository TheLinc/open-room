import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { decodeWslOutput, findWsl, WslRuntime, type WslExec, type WslExecResult } from './wsl'

/** Records every argv and answers from a script of results. */
function recorder(results: Partial<WslExecResult>[] = []) {
  const calls: string[][] = []
  const run: WslExec = async (args) => {
    calls.push(args)
    const next = results.shift() ?? {}
    return {
      code: next.code ?? 0,
      stdout: next.stdout ?? Buffer.alloc(0),
      stderr: next.stderr ?? ''
    }
  }
  return { calls, run }
}

const utf16 = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

describe('findWsl', () => {
  it('finds wsl.exe on a Windows PATH', () => {
    const found = findWsl(
      { Path: 'C:\\Windows\\System32', PATHEXT: '.EXE;.CMD' },
      'win32',
      (p) => p.toLowerCase() === 'c:\\windows\\system32\\wsl.exe'
    )
    expect(found?.toLowerCase()).toBe('c:\\windows\\system32\\wsl.exe')
  })

  it('is null off Windows', () => {
    expect(findWsl({ PATH: '/usr/bin' }, 'darwin', () => true)).toBe(null)
  })
})

describe('decodeWslOutput', () => {
  it('reads UTF-16LE with a byte order mark, and UTF-8 without one', () => {
    expect(decodeWslOutput(utf16('  NAME\r\n* Ubuntu  Running  2\r\n'))).toContain('Ubuntu')
    expect(decodeWslOutput(Buffer.from('/home/u', 'utf8'))).toBe('/home/u')
  })
})

describe('WslRuntime', () => {
  it('is unavailable without wsl.exe and answers empty', async () => {
    const wsl = new WslRuntime(null, null)
    expect(wsl.available).toBe(false)
    expect(await wsl.listDistros()).toEqual([])
    expect(await wsl.pathExists('Ubuntu', '/x')).toBe(false)
    expect(await wsl.homeDir('Ubuntu')).toBe(null)
  })

  it('lists distros with -l -v and decodes the UTF-16 output', async () => {
    const { calls, run } = recorder([
      { stdout: utf16('  NAME  STATE  VERSION\r\n* Ubuntu  Running  2\r\n') }
    ])
    const wsl = new WslRuntime('wsl.exe', run)
    expect(await wsl.listDistros()).toEqual([{ name: 'Ubuntu', isDefault: true, version: 2 }])
    expect(calls[0]).toEqual(['-l', '-v'])
  })

  it('probes a directory with test -d and reads the exit code', async () => {
    const { calls, run } = recorder([{ code: 0 }, { code: 1 }])
    const wsl = new WslRuntime('wsl.exe', run)
    expect(await wsl.pathExists('Ubuntu', '/home/u/proj')).toBe(true)
    expect(await wsl.pathExists('Ubuntu', '/nope')).toBe(false)
    expect(calls[0]).toEqual(['-d', 'Ubuntu', '--exec', 'test', '-d', '/home/u/proj'])
  })

  it('resolves and caches the home directory, and derives the config dir as UNC', async () => {
    const { calls, run } = recorder([{ stdout: Buffer.from('/home/u\n') }])
    const wsl = new WslRuntime('wsl.exe', run)
    expect(await wsl.homeDir('Ubuntu')).toBe('/home/u')
    expect(await wsl.homeDir('Ubuntu')).toBe('/home/u')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['-d', 'Ubuntu', '--exec', 'sh', '-c', 'printf %s "$HOME"'])
    expect(await wsl.configDir('Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\u\\.claude')
  })

  it('does not cache a failed home probe, so a cold distro is retried', async () => {
    const { calls, run } = recorder([{ code: 1 }, { stdout: Buffer.from('/home/u') }])
    const wsl = new WslRuntime('wsl.exe', run)
    expect(await wsl.homeDir('Ubuntu')).toBe(null)
    expect(await wsl.homeDir('Ubuntu')).toBe('/home/u')
    expect(calls).toHaveLength(2)
  })

  it('runs git inside the distro at the given directory', async () => {
    const { calls, run } = recorder([{ code: 0, stdout: Buffer.from('M a.ts\n') }])
    const wsl = new WslRuntime('wsl.exe', run)
    const result = await wsl.git('Ubuntu')(['status', '--porcelain'], '/home/u/proj')
    expect(result).toEqual({ code: 0, stdout: 'M a.ts\n', stderr: '' })
    expect(calls[0]).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/u/proj',
      '--exec',
      'git',
      'status',
      '--porcelain'
    ])
  })

  it('lists files with find, pruning the same directories the host walk ignores', async () => {
    const { calls, run } = recorder([
      { stdout: Buffer.from('./src/b.ts\n./src/a.ts\n./README.md\n') }
    ])
    const wsl = new WslRuntime('wsl.exe', run)
    expect(await wsl.listFiles('Ubuntu', '/home/u/proj')).toEqual([
      'README.md',
      'src/a.ts',
      'src/b.ts'
    ])
    const argv = calls[0]
    expect(argv.slice(0, 6)).toEqual(['-d', 'Ubuntu', '--cd', '/home/u/proj', '--exec', 'find'])
    expect(argv).toContain('node_modules')
    expect(argv).toContain('-prune')
    expect(argv.slice(-3)).toEqual(['-type', 'f', '-print'])
  })

  it('checks the login through a login shell so the distro PATH applies', async () => {
    const { calls, run } = recorder([
      { stdout: Buffer.from(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })) }
    ])
    const wsl = new WslRuntime('wsl.exe', run)
    const status = await wsl.checkLogin('Ubuntu')
    expect(status.state).not.toBe('signed-out')
    expect(calls[0]).toEqual([
      '-d',
      'Ubuntu',
      '--exec',
      'bash',
      '-lc',
      'exec claude "$@"',
      'claude',
      'auth',
      'status',
      '--json'
    ])
  })
})

/**
 * One real run, when a distro exists. Everything above pins argv; this
 * proves wsl.exe honours --cd and --exec and passes exit codes through.
 */
const realWsl = findWsl()
const firstDistro = (() => {
  if (!realWsl) return null
  try {
    const out = execFileSync(realWsl, ['-l', '-q'])
    return (
      decodeWslOutput(out)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean) ?? null
    )
  } catch {
    return null
  }
})()

describe.skipIf(!firstDistro)('WslRuntime against a real distro', () => {
  it('probes /tmp and reads the home directory', async () => {
    const wsl = WslRuntime.fromPath()
    expect(await wsl.pathExists(firstDistro!, '/tmp')).toBe(true)
    expect(await wsl.pathExists(firstDistro!, '/definitely/not/here')).toBe(false)
    expect(await wsl.homeDir(firstDistro!)).toMatch(/^\//)
  })
})
