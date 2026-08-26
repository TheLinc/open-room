import { isAbsolute, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  editorInvocation,
  isExecutableTarget,
  openInEditor,
  resolveExecutable,
  resolveTarget,
  spawnPlan
} from './open-in-editor'

describe('editorInvocation', () => {
  it('substitutes the path and line into the command', () => {
    expect(editorInvocation('code -g {path}:{line}', 'F:/w/a.ts', 12)).toEqual({
      file: 'code',
      args: ['-g', 'F:/w/a.ts:12']
    })
  })

  it('drops a :{line} suffix when no line is known', () => {
    expect(editorInvocation('code -g {path}:{line}', 'F:/w/a.ts')).toEqual({
      file: 'code',
      args: ['-g', 'F:/w/a.ts']
    })
  })

  it('keeps a quoted path with spaces as one argument', () => {
    expect(editorInvocation('subl "{path}"', 'F:/my w/a.ts')).toEqual({
      file: 'subl',
      args: ['F:/my w/a.ts']
    })
  })

  it('returns null for an empty command, meaning use the OS default', () => {
    expect(editorInvocation('   ', 'F:/w/a.ts')).toBeNull()
  })
})

describe('resolveTarget', () => {
  it('joins a relative path onto the workspace', () => {
    const workspace = resolve('workspace-root')
    expect(resolveTarget('src/a.ts', workspace)).toBe(resolve(workspace, 'src/a.ts'))
  })

  it('leaves an absolute path alone', () => {
    const absolute = resolve('elsewhere', 'b.ts')
    expect(isAbsolute(absolute)).toBe(true)
    expect(resolveTarget(absolute, resolve('workspace-root'))).toBe(absolute)
  })
})

describe('resolveExecutable', () => {
  it('finds a .cmd shim under a PATH directory on win32', () => {
    const result = resolveExecutable(
      'code',
      { Path: 'C:\\other;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      'win32',
      (p) => p === 'C:\\tools\\code.CMD'
    )
    expect(result).toBe('C:\\tools\\code.CMD')
  })

  it('finds a bare executable on PATH on darwin', () => {
    const result = resolveExecutable(
      'subl',
      { PATH: '/usr/bin:/usr/local/bin' },
      'darwin',
      (p) => p === '/usr/local/bin/subl'
    )
    expect(result).toBe('/usr/local/bin/subl')
  })

  it('returns null when nothing on PATH matches', () => {
    const result = resolveExecutable(
      'nonexistent-editor',
      { PATH: '/usr/bin' },
      'darwin',
      () => false
    )
    expect(result).toBeNull()
  })

  it('prefers a PATHEXT match over a same-directory extensionless file on win32', () => {
    // Real-world case: an editor's install directory can hold both a POSIX
    // shebang script named exactly `code` (for use under a POSIX shell) and
    // a `code.cmd` shim, side by side, in a directory that PATH lists
    // before anything else. cmd.exe's own lookup for a bare `code` never
    // considers the extensionless file — only PATHEXT-suffixed names — so
    // this must not either, or the resolved path is one `spawn` cannot
    // execute directly (ENOENT).
    const exists = new Set(['C:\\editor\\code', 'C:\\editor\\code.CMD'])
    const result = resolveExecutable(
      'code',
      { Path: 'C:\\editor', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      'win32',
      (p) => exists.has(p)
    )
    expect(result).toBe('C:\\editor\\code.CMD')
  })

  it('returns a file containing a path separator directly, when it exists', () => {
    const result = resolveExecutable(
      '/opt/editor/bin/subl',
      {},
      'darwin',
      (p) => p === '/opt/editor/bin/subl'
    )
    expect(result).toBe('/opt/editor/bin/subl')
  })
})

describe('isExecutableTarget', () => {
  it.each(['notes.bat', 'X.EXE', 'run.lnk', 'tool.app', 'deploy.sh'])(
    'treats %s as executable',
    (path) => {
      expect(isExecutableTarget(path)).toBe(true)
    }
  )

  it.each(['a.ts', 'README.md', 'Makefile', 'archive.tar.gz'])(
    'treats %s as not executable',
    (path) => {
      expect(isExecutableTarget(path)).toBe(false)
    }
  )

  it.each(['C:/x/notes.bat.', 'C:\\x\\notes.bat ', 'C:/x/notes.bat. . '])(
    'treats %s as executable, since Win32 strips the trailing dots and spaces before resolving',
    (path) => {
      expect(isExecutableTarget(path)).toBe(true)
    }
  )

  it('treats an alternate data stream as executable', () => {
    expect(isExecutableTarget('C:/x/notes.txt:evil.bat')).toBe(true)
  })

  it.each(['C:/x/notes.txt.', 'C:/x/a.ts'])(
    'leaves %s not executable after normalisation',
    (path) => {
      expect(isExecutableTarget(path)).toBe(false)
    }
  )
})

describe('spawnPlan', () => {
  it('wraps a .cmd target in a single fully-quoted cmd invocation', () => {
    const plan = spawnPlan(
      'C:\\x\\code.cmd',
      ['-g', 'C:\\w\\a.ts:3'],
      'C:\\Windows\\System32\\cmd.exe'
    )
    expect(plan.file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(plan.args).toEqual(['/d', '/s', '/c', '""C:\\x\\code.cmd" "-g" "C:\\w\\a.ts:3""'])
    expect(plan.verbatim).toBe(true)
  })

  it('passes args through untouched for a non-shim executable', () => {
    const plan = spawnPlan('C:\\tools\\subl.exe', ['a.ts'], 'C:\\Windows\\System32\\cmd.exe')
    expect(plan).toEqual({ file: 'C:\\tools\\subl.exe', args: ['a.ts'], verbatim: false })
  })
})

describe('openInEditor', () => {
  it('reports a command that cannot be resolved instead of claiming success', async () => {
    const result = await openInEditor('definitely-not-an-editor-xyz {path}', 'ignored.txt')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/Could not find/)
  }, 10_000)

  it('refuses to launch an executable target with the OS default, before touching electron', async () => {
    const result = await openInEditor('', 'C:/x/notes.bat')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/executable/)
  })

  it('refuses a trailing-dot executable target, which Win32 would resolve to the real name', async () => {
    const result = await openInEditor('', 'C:/x/notes.bat.')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/executable/)
  })

  it('refuses an argument containing a quote before resolving or spawning', async () => {
    const result = await openInEditor('code {path}', 'a" & calc')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/quotes/)
  })
})
