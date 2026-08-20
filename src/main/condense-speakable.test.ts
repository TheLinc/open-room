import { describe, expect, it } from 'vitest'
import { MAX_SPOKEN_CHARS, speakableAsIs } from './condense'

/**
 * Asking the model to condense costs 8-9s and cannot be made faster — the
 * floor is the round trip, not startup. So a reply that is already short and
 * plain is spoken as written, and only the rest pays.
 *
 * The bias is deliberate: rejecting something speakable costs one model call,
 * while accepting something unspeakable means hearing a file path read out
 * character by character.
 */

describe('speakableAsIs', () => {
  it('accepts an ordinary short reply', () => {
    // Both real examples from the app, spoken instantly rather than in 9s.
    expect(speakableAsIs('The TestProject directory is empty.')).toBe(
      'The TestProject directory is empty.'
    )
    expect(speakableAsIs("I'm doing well and I'm here to help if you need anything.")).toBe(
      "I'm doing well and I'm here to help if you need anything."
    )
  })

  it('trims surrounding whitespace', () => {
    expect(speakableAsIs('  All forty-two tests passed.\t')).toBe('All forty-two tests passed.')
  })

  it('rejects anything empty', () => {
    expect(speakableAsIs('')).toBeNull()
    expect(speakableAsIs('   \n  ')).toBeNull()
  })

  it('rejects a reply long enough to become a recital', () => {
    expect(speakableAsIs('a'.repeat(MAX_SPOKEN_CHARS + 1))).toBeNull()
    expect(speakableAsIs('a'.repeat(MAX_SPOKEN_CHARS))).not.toBeNull()
  })

  it('rejects multi-line replies, which imply structure', () => {
    expect(speakableAsIs('Done.\n- first\n- second')).toBeNull()
  })

  it('rejects code, which does not survive being read aloud', () => {
    expect(speakableAsIs('Run `npm test` to check.')).toBeNull()
    expect(speakableAsIs('I added **bold** emphasis.')).toBeNull()
    expect(speakableAsIs('## Summary of the run')).toBeNull()
  })

  it('rejects file paths in both platforms spelling', () => {
    expect(speakableAsIs('I updated src/main/index.ts for you.')).toBeNull()
    // Real backslashes: an earlier version of this line lost them to escaping,
    // so it was a newline test wearing a path test's name.
    expect(speakableAsIs('I updated C:\\Users\\Lincoln\\notes for you.')).toBeNull()
    expect(speakableAsIs('The failure is at line 42:17 of the file.')).toBeNull()
  })

  it('rejects links and bare filenames', () => {
    expect(speakableAsIs('See https://openroom.dev for details.')).toBeNull()
    expect(speakableAsIs('See www.openroom.dev for details.')).toBeNull()
    expect(speakableAsIs('Check the [docs](https://example.com) first.')).toBeNull()
    expect(speakableAsIs('I rewrote config.json completely.')).toBeNull()
  })

  it('keeps ordinary prose punctuation', () => {
    // Rejecting these would send perfectly speakable text to the model.
    expect(speakableAsIs('It worked — all done, thanks!')).not.toBeNull()
    expect(speakableAsIs('Yes: the build passed (finally).')).not.toBeNull()
    expect(speakableAsIs('I found 42 files, and none were stale.')).not.toBeNull()
  })
})
