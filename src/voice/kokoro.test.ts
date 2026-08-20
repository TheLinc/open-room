import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * "Installed" and "loaded" are different questions, and conflating them is
 * what made the editor offer a 163 MB download for a model already on disk —
 * once per restart, for every agent, because the sidecar starts with nothing
 * in memory.
 *
 * The engine itself is mocked out: this is about which files are on disk, and
 * importing transformers.js for real would pull a large wasm phonemizer into
 * the test run for no added coverage.
 */

const root = await mkdtemp(join(tmpdir(), 'kokoro-installed-'))
process.env.OPEN_ROOM_MODELS = root

vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() } }))
vi.mock('@huggingface/transformers', () => ({ env: { cacheDir: '' } }))

const { isKokoroInstalled, isKokoroLoaded } = await import('./kokoro')

const MODEL_DIR = join(root, 'onnx-community', 'Kokoro-82M-v1.0-ONNX')

async function place(...files: string[]): Promise<void> {
  for (const file of files) {
    const path = join(MODEL_DIR, file)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'x')
  }
}

afterAll(() => {
  delete process.env.OPEN_ROOM_MODELS
})

describe('isKokoroInstalled', () => {
  it('is false when nothing has been downloaded', async () => {
    await expect(isKokoroInstalled()).resolves.toBe(false)
  })

  it('is false when the download was interrupted partway', async () => {
    // transformers.js refetches whatever is missing, so a partial cache is
    // not installed — reporting it as such would skip the download and fail
    // at load time instead.
    await place('config.json', 'tokenizer.json')
    await expect(isKokoroInstalled()).resolves.toBe(false)
  })

  it('is true once every file the loader needs is present', async () => {
    await place('config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_fp16.onnx')
    await expect(isKokoroInstalled()).resolves.toBe(true)
  })

  it('stays independent of whether the weights are loaded in this process', async () => {
    // The exact case that produced the bug: on disk, cold in memory.
    expect(isKokoroLoaded()).toBe(false)
    await expect(isKokoroInstalled()).resolves.toBe(true)
  })
})
