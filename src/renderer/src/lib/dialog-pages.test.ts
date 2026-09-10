import { describe, expect, it } from 'vitest'
import {
  EDITOR_PAGES,
  EDITOR_PAGE_FIELDS,
  SETTINGS_PAGES,
  flaggedPages,
  pageForHighlight
} from './dialog-pages'

describe('pageForHighlight', () => {
  it('opens on General with nothing to point at', () => {
    expect(pageForHighlight(null)).toBe('general')
  })

  it('opens the Voice page for the push-to-talk link', () => {
    expect(pageForHighlight('voice-input')).toBe('voice')
  })
})

describe('settings pages', () => {
  it('lists the five pages in the agreed order', () => {
    expect(SETTINGS_PAGES.map((page) => page.id)).toEqual([
      'general',
      'voice',
      'conversations',
      'appearance',
      'updates'
    ])
  })
})

describe('editor pages', () => {
  it('assigns every form field to exactly one page', () => {
    const all = Object.values(EDITOR_PAGE_FIELDS).flat()
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(
      [
        'name',
        'color',
        'context',
        'workspacePath',
        'wslDistro',
        'worktrees',
        'persistSession',
        'model',
        'effort',
        'fallbackModel',
        'permissionMode',
        'toolPermissions',
        'mcpServersJson',
        'hotkey',
        'notificationsEnabled',
        'ttsEnabled',
        'voiceProvider',
        'voiceId',
        'rate'
      ].sort()
    )
    expect(Object.keys(EDITOR_PAGE_FIELDS).sort()).toEqual(EDITOR_PAGES.map((p) => p.id).sort())
  })

  it('flags the pages holding erroring fields, in page order', () => {
    expect(flaggedPages(['mcpServersJson', 'name'])).toEqual(['identity', 'permissions'])
  })

  it('flags nothing with no errors, and ignores fields it does not know', () => {
    expect(flaggedPages([])).toEqual([])
    expect(flaggedPages(['root'])).toEqual([])
  })
})
