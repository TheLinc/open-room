import { describe, expect, it } from 'vitest'
import { displayPath } from './files-changed'

/**
 * A worktree path is long and identical for every file in a conversation;
 * the row should read like the repository, not like the disk.
 */
describe('displayPath', () => {
  it('strips the checkout root from a path inside it', () => {
    expect(
      displayPath('C:\\home\\worktrees\\atlas\\x7k2\\src\\a.ts', 'C:\\home\\worktrees\\atlas\\x7k2')
    ).toBe('src/a.ts')
    expect(displayPath('/wt/x/src/a.ts', '/wt/x')).toBe('src/a.ts')
  })

  it('ignores case on the root, as Windows and macOS do', () => {
    expect(displayPath('c:\\Work\\notes.txt', 'C:\\work')).toBe('notes.txt')
  })

  it('leaves a path outside the checkout as written', () => {
    expect(displayPath('/other/place/a.ts', '/wt/x')).toBe('/other/place/a.ts')
    expect(displayPath('C:\\wt\\x2\\a.ts', 'C:\\wt\\x')).toBe('C:\\wt\\x2\\a.ts')
  })

  it('leaves a relative path alone', () => {
    expect(displayPath('src/a.ts', '/wt/x')).toBe('src/a.ts')
  })
})
