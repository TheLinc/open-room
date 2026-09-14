import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The condense call is its own one-shot query, and two things about it were
 * wrong at once for a WSL agent whose host login had lapsed: it read the
 * result's `subtype` alone, so an auth failure shaped `success` +
 * `is_error: true` (the measured shape) was spoken as the summary; and it
 * always spawned the host binary, never the agent's distro, so the agent's
 * reply came from a signed-in login and its summary from a signed-out one.
 */

const queryMock = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (input: unknown) => queryMock(input)
}))

vi.mock('./claude-binary', () => ({
  bundledClaudePath: () => 'C:/bundled/claude.exe'
}))

import { condensedLine, condenseForSpeech } from './condense'

function resultStream(result: Record<string, unknown>) {
  return (async function* () {
    yield { type: 'result', ...result }
  })()
}

const LONG_REPLY = 'Here is what I did:\n- edited src/a.ts\n- ran the tests'

describe('condensedLine', () => {
  it('returns the sentence from a genuine success', () => {
    expect(condensedLine({ subtype: 'success', is_error: false, result: ' Done. ' })).toBe('Done.')
  })

  it('refuses a result flagged is_error even when the subtype says success', () => {
    // The measured shape of an expired or missing login on the bundled CLI.
    // Reading the subtype alone spoke this sentence as the agent's summary.
    expect(
      condensedLine({
        subtype: 'success',
        is_error: true,
        result: 'Failed to authenticate. OAuth session expired and failed to refresh.'
      })
    ).toBeNull()
  })

  it('refuses a non-success subtype', () => {
    expect(
      condensedLine({ subtype: 'error_during_execution', is_error: true, result: 'boom' })
    ).toBeNull()
  })

  it('refuses an empty sentence', () => {
    expect(condensedLine({ subtype: 'success', is_error: false, result: '  ' })).toBeNull()
  })
})

describe('condenseForSpeech', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('spawns through the agent spawner when one is given', async () => {
    queryMock.mockReturnValue(
      resultStream({ subtype: 'success', is_error: false, result: 'I edited a file.' })
    )
    const spawner = vi.fn()

    const line = await condenseForSpeech(LONG_REPLY, { spawnClaudeCodeProcess: spawner })

    expect(line).toBe('I edited a file.')
    const options = queryMock.mock.calls[0][0].options
    expect(options.spawnClaudeCodeProcess).toBe(spawner)
    // The host binary still travels as the SDK's `command`; the WSL spawner
    // ignores it, the same as the agent's own session.
    expect(options.pathToClaudeCodeExecutable).toBe('C:/bundled/claude.exe')
  })

  it('uses the host binary alone with no spawner', async () => {
    queryMock.mockReturnValue(resultStream({ subtype: 'success', is_error: false, result: 'Ok.' }))

    await condenseForSpeech(LONG_REPLY)

    const options = queryMock.mock.calls[0][0].options
    expect(options.pathToClaudeCodeExecutable).toBe('C:/bundled/claude.exe')
    expect(options).not.toHaveProperty('spawnClaudeCodeProcess')
  })

  it('stays silent when the condense turn failed to authenticate', async () => {
    queryMock.mockReturnValue(
      resultStream({
        subtype: 'success',
        is_error: true,
        result: 'Failed to authenticate. OAuth session expired and failed to refresh.'
      })
    )

    await expect(condenseForSpeech(LONG_REPLY)).resolves.toBeNull()
  })
})
