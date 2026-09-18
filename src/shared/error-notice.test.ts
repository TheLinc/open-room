import { describe, expect, it } from 'vitest'
import { emptyRuntime, type AgentRuntime } from './agent-runtime'
import { errorNotification } from './error-notice'

const errored = (message: string, hint?: string): AgentRuntime => ({
  ...emptyRuntime('atlas'),
  state: 'error',
  error: { kind: 'crashed', message, ...(hint ? { hint } : {}) }
})

describe('errorNotification', () => {
  it('fires on the step into error, naming the agent and the message', () => {
    expect(errorNotification('working', errored('exited with code 1'), 'Atlas')).toEqual({
      title: 'Atlas hit an error',
      body: 'exited with code 1'
    })
  })

  it('appends the hint when there is one', () => {
    expect(
      errorNotification('working', errored('Signed out', 'Run claude and sign in.'), 'Atlas')
    ).toEqual({
      title: 'Atlas hit an error',
      body: 'Signed out\nRun claude and sign in.'
    })
  })

  it('does not repeat while the agent stays in error', () => {
    // Every runtime patch re-emits the whole runtime; a second toast for the
    // same failure would be the quota heartbeat problem again.
    expect(errorNotification('error', errored('boom'), 'Atlas')).toBeNull()
  })

  it('fires again for a fresh failure after the agent recovered', () => {
    expect(errorNotification('ready', errored('boom'), 'Atlas')).not.toBeNull()
  })

  it('is silent for every other state', () => {
    expect(
      errorNotification('working', { ...emptyRuntime('atlas'), state: 'ready' }, 'Atlas')
    ).toBeNull()
  })

  it('fires for an agent whose first runtime is already an error', () => {
    expect(errorNotification(undefined, errored('boom'), 'Atlas')).not.toBeNull()
  })
})
