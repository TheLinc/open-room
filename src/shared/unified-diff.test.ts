import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './unified-diff'

/**
 * `git diff` output is parsed into hunks with old/new line numbers so the
 * pane can render a real diff view without a library. The input is whatever
 * git printed, so the parser has to be tolerant: a missing trailing newline
 * marker, a binary notice, a rename, or nothing at all.
 */

const EDIT = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' export { a, b }',
  ' // end',
  '@@ -20,2 +21,2 @@ function tail() {',
  '-  return 1',
  '+  return 2',
  ' }',
  '\\ No newline at end of file',
  ''
].join('\n')

describe('parseUnifiedDiff', () => {
  it('numbers context, removed and added lines from the hunk header', () => {
    const [file] = parseUnifiedDiff(EDIT).files
    expect(file.oldPath).toBe('src/a.ts')
    expect(file.newPath).toBe('src/a.ts')
    expect(file.binary).toBe(false)
    expect(file.hunks).toHaveLength(2)

    const [first, second] = file.hunks
    expect(first.header).toBe('@@ -1,4 +1,5 @@')
    expect(first.lines).toEqual([
      { kind: 'context', text: 'const a = 1', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'const b = 2', oldNo: 2, newNo: null },
      { kind: 'add', text: 'const b = 3', oldNo: null, newNo: 2 },
      { kind: 'add', text: 'const c = 4', oldNo: null, newNo: 3 },
      { kind: 'context', text: 'export { a, b }', oldNo: 3, newNo: 4 },
      { kind: 'context', text: '// end', oldNo: 4, newNo: 5 }
    ])

    // The second hunk starts where its header says, not where the first ended.
    expect(second.lines[0]).toEqual({ kind: 'del', text: '  return 1', oldNo: 20, newNo: null })
    // The no-newline marker is kept as a note rather than shown as content.
    expect(second.lines.at(-1)).toEqual({
      kind: 'meta',
      text: 'No newline at end of file',
      oldNo: null,
      newNo: null
    })
  })

  it('counts additions and deletions', () => {
    const [file] = parseUnifiedDiff(EDIT).files
    expect(file.additions).toBe(3)
    expect(file.deletions).toBe(2)
  })

  it('reads a new file as all additions with a /dev/null old side', () => {
    const text = [
      'diff --git a/notes.md b/notes.md',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/notes.md',
      '@@ -0,0 +1,2 @@',
      '+# Notes',
      '+hello',
      ''
    ].join('\n')
    const [file] = parseUnifiedDiff(text).files
    expect(file.oldPath).toBeNull()
    expect(file.newPath).toBe('notes.md')
    expect(file.hunks[0].lines.map((l) => l.newNo)).toEqual([1, 2])
    expect(file.additions).toBe(2)
  })

  it('reports a binary file without hunks', () => {
    const text = [
      'diff --git a/logo.png b/logo.png',
      'index 1..2 100644',
      'Binary files a/logo.png and b/logo.png differ',
      ''
    ].join('\n')
    const [file] = parseUnifiedDiff(text).files
    expect(file.binary).toBe(true)
    expect(file.hunks).toEqual([])
  })

  it('returns no files for empty output', () => {
    expect(parseUnifiedDiff('').files).toEqual([])
    expect(parseUnifiedDiff('\n').files).toEqual([])
  })

  it('does not mistake a removed line starting with "--" for a header', () => {
    const text = [
      'diff --git a/x.sql b/x.sql',
      '--- a/x.sql',
      '+++ b/x.sql',
      '@@ -1,2 +1,1 @@',
      '--- a comment',
      ' select 1',
      ''
    ].join('\n')
    const [file] = parseUnifiedDiff(text).files
    expect(file.hunks[0].lines[0]).toEqual({
      kind: 'del',
      text: '-- a comment',
      oldNo: 1,
      newNo: null
    })
  })
})
