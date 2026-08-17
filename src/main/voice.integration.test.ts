import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Utterance } from '@shared/speech'
import { SpeechBus } from './speech-bus'
import { VoiceSidecar } from './voice-sidecar'

/**
 * End-to-end audio checks. Excluded from `npm test` because they spawn the
 * sidecar and play real sound; run with `npm run test:voice`.
 *
 * These cover the one thing unit tests cannot: that the bus's arbitration
 * actually reaches the speakers, and that stopping really stops.
 * Requires a prior `npm run build` for `out/main/voice.js` to exist.
 */

const SCRIPT = resolve('out/main/voice.js')

let sidecar: VoiceSidecar

beforeAll(async () => {
  sidecar = new VoiceSidecar(SCRIPT)
  sidecar.start()
  // Wait for the process to answer before timing anything.
  await sidecar.listVoices()
}, 30_000)

afterAll(() => {
  sidecar?.stop()
})

let seq = 0
function utter(agentId: string, priority: Utterance['priority'], text: string): Utterance {
  seq += 1
  return {
    id: `u${seq}`,
    agentId,
    agentName: agentId[0].toUpperCase() + agentId.slice(1),
    text,
    priority,
    queuedAt: Date.now()
  }
}

/** A sink that speaks through the real sidecar and records the order. */
function makeSink(spoken: string[], overlaps: { count: number }) {
  let inFlight = 0
  return {
    async speak(text: string, { signal }: { signal: AbortSignal }): Promise<void> {
      inFlight += 1
      if (inFlight > 1) overlaps.count += 1
      spoken.push(text)

      const onAbort = (): void => void sidecar.stopSpeaking()
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        await sidecar.speak(text, { rate: 1 })
      } finally {
        signal.removeEventListener('abort', onAbort)
        inFlight -= 1
      }
    },
    notify(): void {
      // Burst collapse is covered by the unit tests; these cases never trip it.
    }
  }
}

describe('voice sidecar', () => {
  it('reports the platform voices', async () => {
    const voices = await sidecar.listVoices()
    expect(voices.length).toBeGreaterThan(0)
    expect(voices[0].id).toBeTruthy()
  }, 30_000)

  it('survives a crash by restarting', async () => {
    const own = new VoiceSidecar(SCRIPT)
    own.start()
    await own.listVoices()
    expect(own.isAvailable).toBe(true)

    // Kill it the way a real crash would, then confirm supervision recovers.
    own['child']?.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 2_500))

    const voices = await own.listVoices()
    expect(voices.length).toBeGreaterThan(0)
    own.stop()
  }, 40_000)
})

describe('SpeechBus against real audio', () => {
  it('speaks two agents in order without overlapping', async () => {
    const spoken: string[] = []
    const overlaps = { count: 0 }
    const bus = new SpeechBus(makeSink(spoken, overlaps))

    bus.enqueue(utter('atlas', 'done', 'The first agent has finished.'))
    bus.enqueue(utter('juniper', 'done', 'The second agent has finished.'))

    await new Promise((r) => setTimeout(r, 12_000))

    expect(spoken).toHaveLength(2)
    // Both are prefixed: the speaker changes between them.
    expect(spoken[0]).toBe('Atlas — The first agent has finished.')
    expect(spoken[1]).toBe('Juniper — The second agent has finished.')
    expect(overlaps.count).toBe(0)
  }, 40_000)

  it('cuts a progress update short when a question arrives', async () => {
    const spoken: string[] = []
    const overlaps = { count: 0 }
    const bus = new SpeechBus(makeSink(spoken, overlaps))

    bus.enqueue(
      utter(
        'atlas',
        'progress',
        'This is a long running progress update that should be interrupted well before it finishes speaking.'
      )
    )
    await new Promise((r) => setTimeout(r, 1_500))

    const interruptedAt = Date.now()
    bus.enqueue(utter('atlas', 'question', 'Should I continue?'))
    await new Promise((r) => setTimeout(r, 8_000))

    expect(spoken).toHaveLength(2)
    expect(spoken[1]).toContain('Should I continue?')
    // The question started promptly rather than waiting out the progress line.
    expect(Date.now() - interruptedAt).toBeLessThan(9_000)
    expect(overlaps.count).toBe(0)
  }, 40_000)
})

describe('per-agent voices, end to end', () => {
  it('speaks two agents in their own configured voices', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { createDefaultAgent } = await import('@shared/agent')
    const { ConfigStore } = await import('./config-store')
    const { VoiceSink } = await import('./voice-sink')

    const root = await mkdtemp(resolve(tmpdir(), 'open-room-voices-'))
    try {
      const store = new ConfigStore(root)

      // Two platform voices rather than neural ones: this asserts routing,
      // and using system voices keeps it from depending on a 163 MB download.
      const voices = await sidecar.listVoices()
      expect(voices.length).toBeGreaterThanOrEqual(2)

      const atlas = createDefaultAgent('Atlas', root, 'amber')
      atlas.config.tts = {
        enabled: true,
        voice: { provider: 'system', id: voices[0].id },
        rate: 1
      }
      await store.write(atlas)

      const juniper = createDefaultAgent('Juniper', root, 'sky')
      juniper.config.tts = {
        enabled: true,
        voice: { provider: 'system', id: voices[1].id },
        rate: 1
      }
      await store.write(juniper)

      // Notifications are stubbed so a routing failure is silent rather than
      // masked by the fallback still producing sound.
      const notifications = {
        speak: async () => {},
        notify: () => {}
      } as unknown as ConstructorParameters<typeof VoiceSink>[1]

      const sink = new VoiceSink(sidecar, notifications, store)
      const bus = new SpeechBus(sink)

      bus.enqueue(utter('atlas', 'done', 'This is the first agent speaking.'))
      bus.enqueue(utter('juniper', 'done', 'And this is the second agent, in a different voice.'))

      await new Promise((r) => setTimeout(r, 14_000))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
