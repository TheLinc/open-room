import { describe, expect, it } from 'vitest'
import { MAX_SPOKEN_CHARS, speakableAsIs, speakableLead } from './condense'

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

/**
 * A reply with a list or emphasis used to go to the model on that alone,
 * and the model call is 7 to 9 s of silence after the turn. Most such
 * replies open with a plain sentence or two; those are spoken as written
 * and only the structure is dropped. Anything with code or a path in its
 * opening still goes to the model.
 */
describe('speakableLead', () => {
  it('speaks the leading sentences with the markup flattened', () => {
    const reply = [
      'I looked at the three files.',
      '',
      '- **Tests** pass',
      '- Nothing is committed yet.'
    ].join('\n')
    expect(speakableLead(reply)).toBe(
      'I looked at the three files. Tests pass Nothing is committed yet.'
    )
  })

  it('stops before the first sentence carrying code or a path', () => {
    expect(speakableLead('Done.\n\nRun `npm test` to check.')).toBe('Done.')
    expect(speakableLead('All green.\n\nThe change is in src/main/condense.ts now.')).toBe(
      'All green.'
    )
  })

  it('falls through to the model when the opening sentence is unspeakable', () => {
    expect(speakableLead('I edited src/main/condense.ts to fix it. All tests pass.')).toBeNull()
    expect(speakableLead('```\nnpm test\n```\nAll good.')).toBeNull()
  })

  it('speaks link text rather than the address', () => {
    expect(speakableLead('See [the release notes](https://example.com/notes) for details.')).toBe(
      'See the release notes for details.'
    )
  })

  it('drops numbered list markers and headings', () => {
    expect(speakableLead('## Summary\n\n1. Reviewed the plan.\n2. Nothing else changed.')).toBe(
      'Summary Reviewed the plan. Nothing else changed.'
    )
  })

  it('stays under the spoken limit on whole sentences', () => {
    const sentence = 'This sentence is here to fill the reply with ordinary words.'
    const reply = Array.from({ length: 8 }, () => sentence).join('\n\n- ')
    const lead = speakableLead(reply)
    expect(lead).not.toBeNull()
    expect(lead!.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS)
    expect(lead!.endsWith('.')).toBe(true)
  })

  it('is null for nothing', () => {
    expect(speakableLead('')).toBeNull()
    expect(speakableLead('\n\n- \n')).toBeNull()
  })
})
