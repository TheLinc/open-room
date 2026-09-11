import { describe, expect, it } from 'vitest'
import { distrosOf, loginFor, loginGate, loginNotice, type LoginSnapshot } from './login'

const signedIn = { state: 'signed-in' } as const
const signedOut = { state: 'signed-out' } as const
const unknown = { state: 'unknown' } as const

const host = { wsl: null }
const ubuntu = { wsl: { distro: 'Ubuntu' } }
const debian = { wsl: { distro: 'Debian' } }

function snapshot(hostState: LoginSnapshot['host'], wsl: LoginSnapshot['wsl'] = {}): LoginSnapshot {
  return { host: hostState, wsl }
}

describe('distrosOf', () => {
  it('lists each distro once, in first-seen order', () => {
    expect(distrosOf([host, ubuntu, debian, ubuntu])).toEqual(['Ubuntu', 'Debian'])
  })

  it('is empty for host-only agents', () => {
    expect(distrosOf([host, host])).toEqual([])
  })
})

describe('loginFor', () => {
  it('reads the host login for a host agent', () => {
    expect(loginFor(snapshot(signedOut, { Ubuntu: signedIn }), host)).toEqual(signedOut)
  })

  it('reads the distro login for a WSL agent', () => {
    expect(loginFor(snapshot(signedOut, { Ubuntu: signedIn }), ubuntu)).toEqual(signedIn)
  })

  it('treats a distro that has not been probed as unknown, never signed out', () => {
    expect(loginFor(snapshot(signedOut), ubuntu)).toEqual(unknown)
  })
})

describe('loginGate', () => {
  it('shows first run when there are no agents and the host is signed out', () => {
    expect(loginGate(snapshot(signedOut), [])).toBe('first-run')
  })

  it('opens when there are no agents and the host is signed in', () => {
    expect(loginGate(snapshot(signedIn), [])).toBe('open')
  })

  it('opens when the host is signed out but every agent runs in a signed-in distro', () => {
    expect(loginGate(snapshot(signedOut, { Ubuntu: signedIn }), [ubuntu])).toBe('open')
  })

  it('opens when one of two environments is usable', () => {
    expect(loginGate(snapshot(signedOut, { Ubuntu: signedIn }), [host, ubuntu])).toBe('open')
    expect(loginGate(snapshot(signedIn, { Ubuntu: signedOut }), [host, ubuntu])).toBe('open')
  })

  it('shows first run only when every environment the agents use is signed out', () => {
    expect(loginGate(snapshot(signedOut, { Ubuntu: signedOut }), [host, ubuntu])).toBe('first-run')
  })

  it('never locks out on an unknown', () => {
    expect(loginGate(snapshot(unknown), [])).toBe('open')
    expect(loginGate(snapshot(signedOut), [ubuntu])).toBe('open')
    expect(loginGate(snapshot(signedOut, { Ubuntu: unknown }), [ubuntu])).toBe('open')
  })

  it('ignores the host login when no agent runs on the host', () => {
    expect(loginGate(snapshot(signedIn, { Ubuntu: signedOut }), [ubuntu])).toBe('first-run')
  })
})

describe('loginNotice', () => {
  it('says nothing for a signed-in or unknown environment', () => {
    expect(loginNotice(snapshot(signedIn), host)).toBeNull()
    expect(loginNotice(snapshot(unknown), host)).toBeNull()
    expect(loginNotice(snapshot(signedOut), ubuntu)).toBeNull()
  })

  it('tells a host agent how to sign in on this computer', () => {
    expect(loginNotice(snapshot(signedOut, { Ubuntu: signedIn }), host)).toBe(
      'Claude Code on this computer is not signed in. Open a terminal, run `claude`, and sign in.'
    )
  })

  it('tells a WSL agent how to sign in inside its distro', () => {
    expect(loginNotice(snapshot(signedIn, { Ubuntu: signedOut }), ubuntu)).toBe(
      'Claude Code inside Ubuntu is not signed in. Run `wsl -d Ubuntu`, then `claude`, and sign in.'
    )
  })
})
