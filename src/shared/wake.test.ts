import { describe, expect, it } from 'vitest'
import { echoesPlayback, matchWake, type WakeCandidate } from './wake'

const AGENTS: WakeCandidate[] = [
  { id: 'derek', name: 'Derek' },
  { id: 'atlas', name: 'Atlas' },
  { id: 'code-review', name: 'Code Review' }
]

describe('matchWake', () => {
  it('finds the agent and returns the rest as the prompt', () => {
    expect(matchWake('Hey Derek, run the tests', AGENTS)).toEqual({
      agentId: 'derek',
      prompt: 'run the tests'
    })
  })

  it('ignores case and punctuation, which Whisper supplies unpredictably', () => {
    expect(matchWake('hey derek run the tests', AGENTS)?.agentId).toBe('derek')
    expect(matchWake('Hey, Derek. Run the tests.', AGENTS)?.agentId).toBe('derek')
    expect(matchWake('  HEY   DEREK,  run the tests ', AGENTS)?.agentId).toBe('derek')
  })

  it('accepts the near-homophones Whisper produces for the prefix', () => {
    expect(matchWake('Hay Derek, run the tests', AGENTS)?.agentId).toBe('derek')
  })

  it('matches a name by sound rather than spelling', () => {
    // What Whisper heard, not how the user spelled it in config.
    expect(matchWake('Hey Atlus, deploy', AGENTS)?.agentId).toBe('atlas')
  })

  it('matches a multi-word name and strips all of it from the prompt', () => {
    expect(matchWake('Hey Code Review, look at the diff', AGENTS)).toEqual({
      agentId: 'code-review',
      prompt: 'look at the diff'
    })
  })

  it('prefers the longest matching name', () => {
    const agents: WakeCandidate[] = [
      { id: 'code', name: 'Code' },
      { id: 'code-review', name: 'Code Review' }
    ]

    expect(matchWake('Hey Code Review, look at the diff', agents)?.agentId).toBe('code-review')
  })

  it('returns an empty prompt for a bare address', () => {
    expect(matchWake('Hey Derek', AGENTS)).toEqual({ agentId: 'derek', prompt: '' })
  })

  it('requires the prefix, so a bare name does nothing', () => {
    expect(matchWake('Derek run the tests', AGENTS)).toBeNull()
  })

  it('cannot be triggered by the app speaking', () => {
    // The SpeechBus prefixes with a bare name, so its output can never form a
    // valid wake phrase. This is the structural half of self-trigger defence.
    expect(matchWake('Atlas — the build is green', AGENTS)).toBeNull()
    expect(matchWake('Derek — I finished the migration', AGENTS)).toBeNull()
  })

  it('only matches at the start, so talking about an agent is safe', () => {
    expect(matchWake('I told him hey Derek would know', AGENTS)).toBeNull()
  })

  it('returns null for an unknown name', () => {
    expect(matchWake('Hey Sarah, run the tests', AGENTS)).toBeNull()
  })

  it('returns null for the prefix alone', () => {
    expect(matchWake('Hey', AGENTS)).toBeNull()
    expect(matchWake('', AGENTS)).toBeNull()
  })

  it('returns null when there are no agents', () => {
    expect(matchWake('Hey Derek, run the tests', [])).toBeNull()
  })
})

describe('echoesPlayback', () => {
  it('recognises the app hearing its own voice', () => {
    expect(echoesPlayback('the build is green', 'Atlas — the build is green')).toBe(true)
  })

  it('tolerates the words transcription drops', () => {
    expect(echoesPlayback('build is green', 'Atlas — the build is green')).toBe(true)
  })

  it('leaves unrelated speech alone', () => {
    expect(echoesPlayback('run the tests on the new branch', 'Atlas — the build is green')).toBe(
      false
    )
  })

  it('is false when nothing is playing', () => {
    expect(echoesPlayback('run the tests', '')).toBe(false)
  })

  it('is false for an empty transcript', () => {
    expect(echoesPlayback('', 'Atlas — the build is green')).toBe(false)
  })
})
