import { describe, expect, it } from 'vitest'
import { addFile, appendMentions, baseName, fileIconKind } from './file-attachments'

describe('baseName', () => {
  it('takes the last segment of a posix path', () => {
    expect(baseName('/home/dev/project/src/app.tsx')).toBe('app.tsx')
  })

  it('takes the last segment of a Windows path', () => {
    expect(baseName('C:\\Users\\dev\\notes.md')).toBe('notes.md')
  })

  it('returns a bare name unchanged', () => {
    expect(baseName('README')).toBe('README')
  })
})

describe('fileIconKind', () => {
  it('marks React files by extension', () => {
    expect(fileIconKind('App.tsx')).toBe('react')
    expect(fileIconKind('legacy.jsx')).toBe('react')
  })

  it('classifies common extensions', () => {
    expect(fileIconKind('main.ts')).toBe('code')
    expect(fileIconKind('config.JSON')).toBe('data')
    expect(fileIconKind('README.md')).toBe('text')
    expect(fileIconKind('shot.png')).toBe('image')
    expect(fileIconKind('bundle.zip')).toBe('archive')
  })

  it('falls back for unknown and extensionless names', () => {
    expect(fileIconKind('Makefile')).toBe('file')
    expect(fileIconKind('data.xyz')).toBe('file')
    // A leading dot is a hidden file, not an extension.
    expect(fileIconKind('.gitignore')).toBe('file')
  })
})

describe('addFile', () => {
  it('appends a new path', () => {
    expect(addFile([], 'C:\\a\\b.ts')).toEqual([{ path: 'C:\\a\\b.ts' }])
  })

  it('drops a duplicate whatever its casing or separators', () => {
    const list = addFile([], 'C:\\a\\b.ts')
    expect(addFile(list, 'c:/A/B.TS')).toBe(list)
  })
})

describe('appendMentions', () => {
  const workspace = 'C:\\work\\proj'

  it('returns the text untouched with nothing attached', () => {
    expect(appendMentions('do the thing', [], workspace)).toBe('do the thing')
  })

  it('appends workspace files as relative mentions', () => {
    expect(appendMentions('review this', [{ path: 'C:\\work\\proj\\src\\a.ts' }], workspace)).toBe(
      'review this @src/a.ts'
    )
  })

  it('spells an outside file absolute and quotes a space', () => {
    expect(appendMentions('', [{ path: 'C:\\other\\my file.md' }], workspace)).toBe(
      '@"C:/other/my file.md"'
    )
  })

  it('does not double a trailing space', () => {
    expect(appendMentions('look ', [{ path: 'C:\\work\\proj\\b.ts' }], workspace)).toBe(
      'look @b.ts'
    )
  })
})
