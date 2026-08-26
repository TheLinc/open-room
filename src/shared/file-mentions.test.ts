import { describe, expect, it } from 'vitest'
import { applyMention, filterFiles, mentionAt, mentionFor } from './file-mentions'

describe('mentionAt', () => {
  it('finds an @ at the start of the draft', () => {
    expect(mentionAt('@src', 4)).toEqual({ start: 0, end: 4, query: 'src' })
  })

  it('finds an @ after whitespace, with the caret inside the word', () => {
    expect(mentionAt('fix @src/ma please', 10)).toEqual({ start: 4, end: 10, query: 'src/m' })
  })

  it('offers everything for a bare @', () => {
    expect(mentionAt('look at @', 9)).toEqual({ start: 8, end: 9, query: '' })
  })

  it('ignores an @ in the middle of a word, which is an email', () => {
    expect(mentionAt('mail me@example.com', 19)).toBeNull()
  })

  it('closes once the caret has left the word', () => {
    expect(mentionAt('@src/main.ts is broken', 22)).toBeNull()
  })
})

describe('filterFiles', () => {
  const files = ['src/main/index.ts', 'src/main/ipc.ts', 'src/shared/ipc.ts', 'README.md']

  it('returns the first files when the query is empty', () => {
    expect(filterFiles(files, '', 2)).toEqual(['src/main/index.ts', 'src/main/ipc.ts'])
  })

  it('matches subsequences, case-insensitively', () => {
    expect(filterFiles(files, 'smipc')).toEqual(['src/main/ipc.ts'])
  })

  it('ranks a basename match above a directory match', () => {
    expect(filterFiles(files, 'ipc')).toEqual(['src/main/ipc.ts', 'src/shared/ipc.ts'])
    expect(filterFiles(files, 'readme')[0]).toBe('README.md')
  })

  it('caps the result', () => {
    expect(filterFiles(files, '', 1)).toHaveLength(1)
  })
})

describe('applyMention', () => {
  it('replaces the query with the path and a trailing space, caret after it', () => {
    expect(
      applyMention('fix @src/m now', { start: 4, end: 10, query: 'src/m' }, 'src/main/ipc.ts')
    ).toEqual({
      draft: 'fix @src/main/ipc.ts now',
      caret: 20
    })
  })
})

describe('mentionFor', () => {
  it('relativises a path inside the workspace with forward slashes', () => {
    expect(mentionFor('F:\\work\\app\\src\\a.ts', 'F:\\work\\app')).toBe('@src/a.ts')
  })

  it('keeps an absolute path for a file outside the workspace', () => {
    expect(mentionFor('C:\\other\\notes.md', 'F:\\work\\app')).toBe('@C:/other/notes.md')
  })

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(mentionFor('F:\\work\\app2\\x.ts', 'F:\\work\\app')).toBe('@F:/work/app2/x.ts')
  })

  it('quotes a path containing spaces', () => {
    expect(mentionFor('/home/u/my app/src/a.ts', '/home/u/my app')).toBe('@src/a.ts')
    expect(mentionFor('/home/u/docs/a b.md', '/home/u/my app')).toBe('@"/home/u/docs/a b.md"')
  })
})
