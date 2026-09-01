import { describe, expect, it } from 'vitest'
import {
  isLinuxAbsolutePath,
  linuxToUnc,
  parseWslDistroList,
  uncToLinux,
  wslChildEnv,
  wslClaudeArgv,
  wslExecArgv,
  wslLoginHint
} from './wsl'

describe('isLinuxAbsolutePath', () => {
  it('accepts a rooted Linux path and nothing else', () => {
    expect(isLinuxAbsolutePath('/home/u/proj')).toBe(true)
    expect(isLinuxAbsolutePath('/')).toBe(true)
    expect(isLinuxAbsolutePath('home/u')).toBe(false)
    expect(isLinuxAbsolutePath('C:\\work')).toBe(false)
    expect(isLinuxAbsolutePath('//server/share')).toBe(false)
    expect(isLinuxAbsolutePath('')).toBe(false)
  })
})

describe('linuxToUnc', () => {
  it('maps a Linux path into the distro share', () => {
    expect(linuxToUnc('Ubuntu', '/home/u/proj/src/a.ts')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj\\src\\a.ts'
    )
  })

  it('maps the root to the share root', () => {
    expect(linuxToUnc('Ubuntu', '/')).toBe('\\\\wsl.localhost\\Ubuntu\\')
  })
})

describe('uncToLinux', () => {
  it('reads both the current and the legacy share names', () => {
    expect(uncToLinux('\\\\wsl.localhost\\Ubuntu\\home\\u\\proj')).toEqual({
      distro: 'Ubuntu',
      path: '/home/u/proj'
    })
    expect(uncToLinux('\\\\wsl$\\Ubuntu-22.04\\home\\u')).toEqual({
      distro: 'Ubuntu-22.04',
      path: '/home/u'
    })
  })

  it('maps the share root to / and ignores a trailing separator', () => {
    expect(uncToLinux('\\\\wsl.localhost\\Ubuntu\\')).toEqual({ distro: 'Ubuntu', path: '/' })
    expect(uncToLinux('\\\\wsl.localhost\\Ubuntu\\home\\')).toEqual({
      distro: 'Ubuntu',
      path: '/home'
    })
  })

  it('returns null for anything that is not a WSL share', () => {
    expect(uncToLinux('C:\\work')).toBe(null)
    expect(uncToLinux('\\\\nas\\share\\x')).toBe(null)
    expect(uncToLinux('/home/u')).toBe(null)
  })
})

describe('parseWslDistroList', () => {
  // `wsl.exe -l -v`, already decoded from UTF-16.
  const output = [
    '  NAME              STATE           VERSION',
    '* Ubuntu            Running         2',
    '  docker-desktop    Stopped         2',
    '  Legacy            Stopped         1',
    ''
  ].join('\r\n')

  it('reads the name, default marker and version of each row', () => {
    expect(parseWslDistroList(output)).toEqual([
      { name: 'Ubuntu', isDefault: true, version: 2 },
      { name: 'docker-desktop', isDefault: false, version: 2 },
      { name: 'Legacy', isDefault: false, version: 1 }
    ])
  })

  it('is empty for no output or a header alone', () => {
    expect(parseWslDistroList('')).toEqual([])
    expect(parseWslDistroList('  NAME  STATE  VERSION\r\n')).toEqual([])
  })

  it('tolerates a leading byte order mark', () => {
    expect(parseWslDistroList('\uFEFF' + output)).toHaveLength(3)
  })
})

describe('wslChildEnv', () => {
  it('forwards only Claude and Anthropic variables, sorted', () => {
    expect(
      wslChildEnv({
        Path: 'C:\\Windows',
        USERPROFILE: 'C:\\Users\\u',
        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'open-room',
        ANTHROPIC_BASE_URL: 'https://x',
        undefinedOne: undefined
      })
    ).toEqual([
      'ANTHROPIC_BASE_URL=https://x',
      'CLAUDE_AGENT_SDK_CLIENT_APP=open-room',
      'CLAUDE_CODE_ENTRYPOINT=sdk-ts'
    ])
  })

  it('never forwards the API key or a Windows config dir', () => {
    // The key would bill API credits instead of the distro's login; the
    // config dirs are Windows paths that would point the Linux CLI at a
    // Windows ~/.claude.
    expect(
      wslChildEnv({
        ANTHROPIC_API_KEY: 'sk-x',
        CLAUDE_CONFIG_DIR: 'C:\\Users\\u\\.claude',
        CLAUDE_SECURESTORAGE_CONFIG_DIR: 'C:\\Users\\u\\.claude',
        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts'
      })
    ).toEqual(['CLAUDE_CODE_ENTRYPOINT=sdk-ts'])
  })
})

describe('wslExecArgv', () => {
  it('runs an argv inside the distro at a directory, with no shell', () => {
    expect(wslExecArgv('Ubuntu', '/home/u/proj', ['git', 'status'])).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/u/proj',
      '--exec',
      'git',
      'status'
    ])
  })

  it('omits --cd when there is no directory', () => {
    expect(wslExecArgv('Ubuntu', null, ['test', '-d', '/x'])).toEqual([
      '-d',
      'Ubuntu',
      '--exec',
      'test',
      '-d',
      '/x'
    ])
  })
})

describe('wslClaudeArgv', () => {
  it('launches claude through a login shell with positional args and an env allowlist', () => {
    expect(
      wslClaudeArgv({
        distro: 'Ubuntu',
        cwd: '/home/u/proj',
        env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', Path: 'C:\\Windows', ANTHROPIC_API_KEY: 'x' },
        args: ['--output-format', 'stream-json', '--verbose']
      })
    ).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/u/proj',
      '--exec',
      '/usr/bin/env',
      'CLAUDE_CODE_ENTRYPOINT=sdk-ts',
      'bash',
      '-lc',
      'exec claude "$@"',
      'claude',
      '--output-format',
      'stream-json',
      '--verbose'
    ])
  })

  it('keeps the bash script constant whatever the arguments are', () => {
    // Arguments are positional so wsl.exe's re-quoting of the command line
    // can never touch them; the script is the same string every time.
    const a = wslClaudeArgv({ distro: 'U', cwd: '/a', env: {}, args: ['x "y"'] })
    const b = wslClaudeArgv({ distro: 'U', cwd: '/b', env: {}, args: ["it's"] })
    expect(a[a.indexOf('-lc') + 1]).toBe('exec claude "$@"')
    expect(b[b.indexOf('-lc') + 1]).toBe('exec claude "$@"')
    expect(a.at(-1)).toBe('x "y"')
    expect(b.at(-1)).toBe("it's")
  })
})

describe('wslLoginHint', () => {
  it('names the distro and the two commands', () => {
    expect(wslLoginHint('Ubuntu')).toBe(
      'Claude Code inside Ubuntu is not signed in. Run `wsl -d Ubuntu`, then `claude`, and sign in.'
    )
  })
})
