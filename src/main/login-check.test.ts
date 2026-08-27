import { describe, expect, it } from 'vitest'
import { parseAuthStatus } from './login-check'

describe('parseAuthStatus', () => {
  it('reads a signed-in subscription account', () => {
    const out = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'someone@example.com',
      subscriptionType: 'max'
    })
    expect(parseAuthStatus(out)).toEqual({
      state: 'signed-in',
      email: 'someone@example.com',
      authMethod: 'claude.ai',
      subscriptionType: 'max'
    })
  })

  it('reads a signed-out account', () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ state: 'signed-out' })
  })

  it('tolerates the CLI printing something before the JSON', () => {
    const out = 'Checking…\n' + JSON.stringify({ loggedIn: true, authMethod: 'console' })
    expect(parseAuthStatus(out)).toEqual({ state: 'signed-in', authMethod: 'console' })
  })

  it('reports output it cannot read as unknown rather than as signed out', () => {
    // A false "signed out" would lock a working install behind the
    // first-run screen; unknown lets the agents try.
    expect(parseAuthStatus('')).toEqual({ state: 'unknown' })
    expect(parseAuthStatus('not json')).toEqual({ state: 'unknown' })
    expect(parseAuthStatus('{"loggedIn":"yes"}')).toEqual({ state: 'unknown' })
  })
})
