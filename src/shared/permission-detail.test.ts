import { describe, expect, it } from 'vitest'
import { permissionDetail } from './permission-detail'

describe('permissionDetail', () => {
  it('shows an Edit as before and after', () => {
    expect(
      permissionDetail('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' })
    ).toEqual({
      kind: 'edit',
      path: 'a.ts',
      edits: [{ before: 'x', after: 'y' }]
    })
  })

  it('shows a MultiEdit as one pair per entry', () => {
    const detail = permissionDetail('MultiEdit', {
      file_path: 'a.ts',
      edits: [
        { old_string: 'one', new_string: '1' },
        { old_string: 'two', new_string: '2' }
      ]
    })
    expect(detail).toEqual({
      kind: 'edit',
      path: 'a.ts',
      edits: [
        { before: 'one', after: '1' },
        { before: 'two', after: '2' }
      ]
    })
  })

  it('skips malformed MultiEdit entries and keeps the valid ones', () => {
    const detail = permissionDetail('MultiEdit', {
      file_path: 'a.ts',
      edits: [null, { old_string: 'a', new_string: 'b' }, 'junk']
    })
    expect(detail).toEqual({
      kind: 'edit',
      path: 'a.ts',
      edits: [{ before: 'a', after: 'b' }]
    })
  })

  it('falls back to none for a MultiEdit with no valid entries', () => {
    expect(permissionDetail('MultiEdit', { file_path: 'a.ts', edits: [null] })).toEqual({
      kind: 'none'
    })
  })

  it('shows a Write as the path and its content', () => {
    expect(permissionDetail('Write', { file_path: 'b.ts', content: 'hi' })).toEqual({
      kind: 'write',
      path: 'b.ts',
      content: 'hi'
    })
  })

  it('shows Bash as the command with its description', () => {
    expect(permissionDetail('Bash', { command: 'rm -rf dist', description: 'Clean' })).toEqual({
      kind: 'command',
      command: 'rm -rf dist',
      description: 'Clean'
    })
  })

  it('shows the path for Read and the pattern for Glob and Grep', () => {
    expect(permissionDetail('Read', { file_path: 'a.ts' })).toEqual({
      kind: 'path',
      label: 'File',
      value: 'a.ts'
    })
    expect(permissionDetail('Glob', { pattern: '**/*.ts' })).toEqual({
      kind: 'path',
      label: 'Pattern',
      value: '**/*.ts'
    })
    expect(permissionDetail('Grep', { pattern: 'TODO', path: 'src' })).toEqual({
      kind: 'path',
      label: 'Pattern',
      value: 'TODO in src'
    })
  })

  it('falls back to none for an unknown tool or a malformed input', () => {
    expect(permissionDetail('mcp__x__y', { a: 1 })).toEqual({ kind: 'none' })
    expect(permissionDetail('Edit', { file_path: 3 })).toEqual({ kind: 'none' })
  })
})
