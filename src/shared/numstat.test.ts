import { describe, expect, it } from 'vitest'
import { parseNumstat } from './numstat'

describe('parseNumstat', () => {
  it('reads added and removed lines per file', () => {
    const stats = parseNumstat('12\t3\tsrc/app.ts\n0\t7\tREADME.md\n')
    expect(stats.get('src/app.ts')).toEqual({ added: 12, removed: 3 })
    expect(stats.get('README.md')).toEqual({ added: 0, removed: 7 })
  })

  it('marks a binary file, which git counts as dashes', () => {
    expect(parseNumstat('-\t-\tlogo.png').get('logo.png')).toEqual({ binary: true })
  })

  it('names an untracked file by its real path, not the /dev/null rename', () => {
    expect(parseNumstat('5\t0\t/dev/null => notes/new.md\n').get('notes/new.md')).toEqual({
      added: 5,
      removed: 0
    })
    // Git for Windows spells /dev/null as `nul` (measured).
    expect(parseNumstat('2\t0\tnul => new.txt').get('new.txt')).toEqual({ added: 2, removed: 0 })
  })

  it('ignores anything else git prints', () => {
    expect(parseNumstat('warning: LF will be replaced by CRLF\n').size).toBe(0)
  })
})
