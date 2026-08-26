import { isAbsolute, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { editorInvocation, openInEditor, resolveTarget } from './open-in-editor'

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

describe('openInEditor', () => {
  it('reports a command the shell cannot find instead of claiming success', async () => {
    const result = await openInEditor('definitely-not-an-editor-xyz {path}', 'ignored.txt')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/exited with code|not found|ENOENT/i)
  }, 10_000)
})
