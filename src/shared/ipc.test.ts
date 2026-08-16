import { describe, expect, it } from 'vitest'
import { IpcChannel } from './ipc'

describe('IPC contract', () => {
  it('namespaces every channel so main-process handlers cannot collide', () => {
    for (const channel of Object.values(IpcChannel)) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/)
    }
  })

  it('declares no duplicate channel names', () => {
    const names = Object.values(IpcChannel)
    expect(new Set(names).size).toBe(names.length)
  })
})
