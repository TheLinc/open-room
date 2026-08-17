import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * transformers.js is mocked rather than imported.
 *
 * Loading it pulls in a large wasm phonemizer — the same reason the sidecar
 * imports it lazily — and none of these assertions need an inference engine.
 */
const env: Record<string, unknown> = {}
const pipeline = vi.fn()

vi.mock('@huggingface/transformers', () => ({ env, pipeline }))

const { cleanTranscript, sttModelRoot } = await import('./stt')

const originalModels = process.env.OPEN_ROOM_MODELS

afterEach(() => {
  if (originalModels === undefined) delete process.env.OPEN_ROOM_MODELS
  else process.env.OPEN_ROOM_MODELS = originalModels
  pipeline.mockReset()
})

describe('sttModelRoot', () => {
  it('is the stt subdirectory of the models root', () => {
    process.env.OPEN_ROOM_MODELS = join('/tmp', 'models')
    expect(sttModelRoot()).toBe(join('/tmp', 'models', 'stt'))
  })

  it('does not file speech-to-text weights under a kokoro directory', () => {
    process.env.OPEN_ROOM_MODELS = join('/tmp', 'models')
    expect(sttModelRoot()).not.toContain('kokoro')
  })

  it('is read at call time so the models root can be relocated', () => {
    process.env.OPEN_ROOM_MODELS = join('/tmp', 'first')
    const first = sttModelRoot()
    process.env.OPEN_ROOM_MODELS = join('/tmp', 'second')

    expect(sttModelRoot()).not.toBe(first)
  })
})

/**
 * A module with no loaded instance.
 *
 * `instance` and `loading` are module-level, and `loadStt` short-circuits once
 * one is set — so tests that assert on loading behaviour each need their own
 * copy of the module rather than the shared one.
 */
async function freshStt(): Promise<typeof import('./stt')> {
  vi.resetModules()
  return import('./stt')
}

describe('loadStt', () => {
  it('loads from disk with remote fetching disabled', async () => {
    process.env.OPEN_ROOM_MODELS = join('/tmp', 'models')
    pipeline.mockResolvedValue({})

    await (await freshStt()).loadStt('whisper-tiny-en')

    // Acquisition belongs to ModelManager, which verifies a checksum and can
    // resume. transformers.js fetching its own copy would bypass both.
    expect(env.allowRemoteModels).toBe(false)
    expect(env.allowLocalModels).toBe(true)
    expect(env.localModelPath).toBe(join('/tmp', 'models', 'stt'))
  })

  it('asks for the catalog id, which is the directory ModelManager populated', async () => {
    pipeline.mockResolvedValue({})

    await (await freshStt()).loadStt('whisper-tiny-en')

    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'whisper-tiny-en',
      expect.objectContaining({ dtype: 'fp32', device: 'cpu' })
    )
  })

  it('reports loaded only after the pipeline resolves', async () => {
    const fresh = await freshStt()
    pipeline.mockResolvedValue({})

    expect(fresh.isSttLoaded()).toBe(false)
    await fresh.loadStt('whisper-tiny-en')
    expect(fresh.isSttLoaded()).toBe(true)
  })

  it('clears the shared promise on failure so a retry is possible', async () => {
    const fresh = await freshStt()
    pipeline.mockRejectedValueOnce(new Error('corrupt weights'))

    await expect(fresh.loadStt('whisper-tiny-en')).rejects.toThrow(/corrupt weights/)

    pipeline.mockResolvedValue({})
    await expect(fresh.loadStt('whisper-tiny-en')).resolves.toBeDefined()
  })
})

describe('transcribe', () => {
  it('refuses rather than hiding a 147 MB download behind a transcription', async () => {
    const fresh = await freshStt()

    await expect(fresh.transcribe(new Float32Array(16_000))).rejects.toThrow(/no speech-to-text/i)
  })

  it('returns nothing for audio too short to contain speech', async () => {
    const fresh = await freshStt()

    // Checked before the loaded-model guard: a mis-tapped hotkey should do
    // nothing, not raise.
    await expect(fresh.transcribe(new Float32Array(100))).resolves.toBe('')
  })
})

describe('cleanTranscript', () => {
  it('strips bracketed non-speech annotations', () => {
    expect(cleanTranscript('[BLANK_AUDIO] deploy the branch')).toBe('deploy the branch')
    expect(cleanTranscript('(wind blowing) hello')).toBe('hello')
  })
})
