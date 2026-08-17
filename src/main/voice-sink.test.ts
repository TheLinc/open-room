import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAgent, type Agent } from '@shared/agent'
import type { Utterance } from '@shared/speech'
import { ConfigStore } from './config-store'
import { VoiceSink } from './voice-sink'
import type { NotificationSink } from './notification-sink'
import type { VoiceSidecar } from './voice-sidecar'

/**
 * Per-agent voice routing.
 *
 * Each agent having its own voice is a product promise, not an incidental
 * detail — distinct voices are how you tell which agent is talking when you
 * are looking at something else. These cover that, plus every branch of the
 * fallback chain, since a message the user never receives is the one outcome
 * worth avoiding.
 */

type SpokenCall = { text: string; voiceId?: string; rate: number; provider?: string }

let root: string
let store: ConfigStore
let spoken: SpokenCall[]
let notified: string[]
let sidecarAvailable: boolean
let speakBehaviour: 'resolve' | 'throw' | 'hang'

function fakeSidecar(): VoiceSidecar {
  return {
    get isAvailable() {
      return sidecarAvailable
    },
    async speak(text: string, options: { voiceId?: string; rate: number; provider?: string }) {
      spoken.push({ text, ...options })
      if (speakBehaviour === 'throw') throw new Error('synthesis failed')
      if (speakBehaviour === 'hang') await new Promise(() => {})
    },
    stopSpeaking: async () => {
      stopCalls += 1
    }
  } as unknown as VoiceSidecar
}

let stopCalls = 0

function fakeNotifications(): NotificationSink {
  return {
    async speak(text: string) {
      notified.push(text)
    },
    notify() {
      // Burst collapse is the bus's concern, not the sink's.
    }
  } as unknown as NotificationSink
}

function utterance(agentId: string, text = 'hello'): Utterance {
  return {
    id: 'u1',
    agentId,
    agentName: agentId,
    text,
    priority: 'done',
    queuedAt: Date.now()
  }
}

async function writeAgent(mutate: (agent: Agent) => void): Promise<Agent> {
  const agent = createDefaultAgent('Atlas', root, 'amber')
  mutate(agent)
  await store.write(agent)
  return agent
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-room-sink-'))
  store = new ConfigStore(root)
  spoken = []
  notified = []
  stopCalls = 0
  sidecarAvailable = true
  speakBehaviour = 'resolve'
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const sink = (): VoiceSink => new VoiceSink(fakeSidecar(), fakeNotifications(), store)

const speak = (agentId: string, text = 'hello'): Promise<void> =>
  sink().speak(`${agentId} — ${text}`, {
    signal: new AbortController().signal,
    utterance: utterance(agentId, text)
  })

describe('per-agent voice configuration', () => {
  it('uses the voice each agent is configured with', async () => {
    const atlas = createDefaultAgent('Atlas', root, 'amber')
    atlas.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    await store.write(atlas)

    const juniper = createDefaultAgent('Juniper', root, 'sky')
    juniper.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'bf_emma' }, rate: 1 }
    await store.write(juniper)

    await speak('atlas')
    await speak('juniper')

    // The whole point: two agents, two different voices.
    expect(spoken.map((s) => s.voiceId)).toEqual(['af_heart', 'bf_emma'])
  })

  it('carries each agent own rate', async () => {
    const slow = createDefaultAgent('Atlas', root, 'amber')
    slow.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1.5 }
    await store.write(slow)

    const fast = createDefaultAgent('Juniper', root, 'sky')
    fast.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_bella' }, rate: 0.8 }
    await store.write(fast)

    await speak('atlas')
    await speak('juniper')

    expect(spoken.map((s) => s.rate)).toEqual([1.5, 0.8])
  })

  it('lets agents use different engines simultaneously', async () => {
    const neural = createDefaultAgent('Atlas', root, 'amber')
    neural.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    await store.write(neural)

    const platform = createDefaultAgent('Juniper', root, 'sky')
    platform.config.tts = { enabled: true, voice: { provider: 'system', id: 'Zira' }, rate: 1 }
    await store.write(platform)

    await speak('atlas')
    await speak('juniper')

    expect(spoken.map((s) => s.provider)).toEqual(['kokoro', 'system'])
  })

  it('reads config per utterance, so an edit applies without a restart', async () => {
    await writeAgent((a) => {
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })
    await speak('atlas')

    await writeAgent((a) => {
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'am_michael' }, rate: 1 }
    })
    await speak('atlas')

    expect(spoken.map((s) => s.voiceId)).toEqual(['af_heart', 'am_michael'])
  })

  it('sends an empty system id as undefined, meaning the platform default', async () => {
    await writeAgent((a) => {
      a.config.tts = { enabled: true, voice: { provider: 'system', id: '' }, rate: 1 }
    })

    await speak('atlas')
    expect(spoken[0].voiceId).toBeUndefined()
    expect(spoken[0].provider).toBe('system')
  })
})

describe('notifications and speech are independent', () => {
  it('does both when both are switched on', async () => {
    await writeAgent((a) => {
      a.config.notifications = true
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })

    await speak('atlas')
    expect(spoken).toHaveLength(1)
    expect(notified).toHaveLength(1)
  })

  it('notifies only, when speech is off', async () => {
    await writeAgent((a) => {
      a.config.notifications = true
      a.config.tts = { enabled: false }
    })

    await speak('atlas')
    expect(spoken).toHaveLength(0)
    expect(notified).toHaveLength(1)
  })

  it('speaks only, when notifications are off', async () => {
    await writeAgent((a) => {
      a.config.notifications = false
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })

    await speak('atlas')
    expect(spoken).toHaveLength(1)
    expect(notified).toHaveLength(0)
  })

  it('stays silent when both are off, leaving only the transcript', async () => {
    await writeAgent((a) => {
      a.config.notifications = false
      a.config.tts = { enabled: false }
    })

    await speak('atlas')
    expect(spoken).toHaveLength(0)
    expect(notified).toHaveLength(0)
  })

  it('defaults notifications on for a new agent', async () => {
    const agent = await writeAgent(() => {})
    expect(agent.config.notifications).toBe(true)
  })
})

describe('delivery fallback', () => {
  it('notifies when speech fails and notifications were off', async () => {
    await writeAgent((a) => {
      a.config.notifications = false
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })
    speakBehaviour = 'throw'

    // A one-off delivery failure is different from the routine notifications
    // the user opted out of; losing the message entirely would be worse.
    await speak('atlas')
    expect(notified).toHaveLength(1)
  })

  it('does not double-notify when notifications are already on', async () => {
    await writeAgent((a) => {
      a.config.notifications = true
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })
    speakBehaviour = 'throw'

    await speak('atlas')
    expect(notified).toHaveLength(1)
  })

  it('notifies when the sidecar is down', async () => {
    await writeAgent((a) => {
      a.config.notifications = false
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })
    sidecarAvailable = false

    await speak('atlas')
    expect(spoken).toHaveLength(0)
    expect(notified).toHaveLength(1)
  })

  it('notifies when the agent cannot be read at all', async () => {
    await speak('never-existed')
    expect(spoken).toHaveLength(0)
    expect(notified).toHaveLength(1)
  })
})

describe('interruption', () => {
  it('tells the sidecar to stop when the utterance is aborted', async () => {
    await writeAgent((a) => {
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })
    speakBehaviour = 'hang'

    const controller = new AbortController()
    void sink().speak('Atlas — talking', {
      signal: controller.signal,
      utterance: utterance('atlas')
    })

    // Let the sink reach the sidecar before cutting it off.
    await new Promise((r) => setTimeout(r, 20))
    controller.abort()
    await new Promise((r) => setTimeout(r, 20))

    expect(stopCalls).toBe(1)
  })

  it('does not fall back to a notification after a deliberate interrupt', async () => {
    await writeAgent((a) => {
      a.config.notifications = false
      a.config.tts = { enabled: true, voice: { provider: 'kokoro', id: 'af_heart' }, rate: 1 }
    })
    speakBehaviour = 'throw'

    const controller = new AbortController()
    controller.abort()

    await sink().speak('Atlas — talking', {
      signal: controller.signal,
      utterance: utterance('atlas')
    })

    // The user cut this off on purpose; repeating it as a notification would
    // resurrect exactly what they silenced.
    expect(notified).toHaveLength(0)
  })
})
