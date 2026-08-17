import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG, type CatalogEntry } from '@shared/model-catalog'
import { ModelManager, sha256Of } from './model-manager'

/**
 * Served against a local HTTP server rather than the real internet: these
 * tests must be fast, offline, and able to simulate a dropped connection on
 * demand, none of which a real download allows.
 */
const PAYLOAD = Buffer.from('x'.repeat(4096))
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex')

let server: Server
let baseUrl: string
let root: string
let manager: ModelManager

/** Set by a test to make the next response misbehave. */
let mode: 'normal' | 'ignore-range' | 'truncate' | 'corrupt' = 'normal'

beforeAll(async () => {
  server = createServer((req, res) => {
    const range = req.headers.range
    const body = mode === 'corrupt' ? Buffer.from('y'.repeat(PAYLOAD.length)) : PAYLOAD

    if (range && mode !== 'ignore-range') {
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
      const slice = body.subarray(start)
      res.writeHead(206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${body.length - 1}/${body.length}`
      })
      res.end(slice)
      return
    }

    if (mode === 'truncate') {
      // Headers promise the whole file, then the connection drops halfway —
      // exactly what a flaky network looks like.
      res.writeHead(200, { 'content-length': String(body.length) })
      res.write(body.subarray(0, body.length / 2))
      res.destroy()
      return
    }

    res.writeHead(200, { 'content-length': String(body.length) })
    res.end(body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(async () => {
  mode = 'normal'
  root = await mkdtemp(join(tmpdir(), 'open-room-models-'))
  manager = new ModelManager(root)

  // Replace the shipped catalog with one pointing at the local server.
  const entry: CatalogEntry = {
    id: 'test-model',
    kind: 'stt',
    label: 'Test Model',
    description: 'Fixture',
    license: 'MIT',
    attribution: 'test',
    homepage: 'https://example.com',
    files: [
      {
        name: 'model.bin',
        url: `${baseUrl}/model.bin`,
        sha256: PAYLOAD_SHA,
        sizeBytes: PAYLOAD.length
      }
    ]
  }
  CATALOG.length = 0
  CATALOG.push(entry)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const entry = (): CatalogEntry => CATALOG[0]

describe('ModelManager download', () => {
  it('fetches a model and verifies its checksum', async () => {
    await manager.download('test-model')

    expect(await manager.isInstalled(entry())).toBe(true)
    const written = await readFile(manager.pathFor(entry(), entry().files[0]))
    expect(written.equals(PAYLOAD)).toBe(true)
  })

  it('reports progress up to the full size', async () => {
    const seen: number[] = []
    await manager.download('test-model', (p) => seen.push(p.receivedBytes))

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(PAYLOAD.length)
    // Progress is monotonic; a UI bar that goes backwards is a bug.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('leaves nothing behind when the checksum fails', async () => {
    mode = 'corrupt'
    await expect(manager.download('test-model')).rejects.toThrow(/checksum/i)

    // A half-written model that looks installed is worse than none at all.
    expect(await manager.isInstalled(entry())).toBe(false)
    await expect(stat(manager.dirFor(entry()))).rejects.toThrow()
  })

  it('resumes from a partial file instead of restarting', async () => {
    await mkdir(manager.dirFor(entry()), { recursive: true })
    const partial = `${manager.pathFor(entry(), entry().files[0])}.partial`
    await writeFile(partial, PAYLOAD.subarray(0, 1000))

    const first: number[] = []
    await manager.download('test-model', (p) => first.push(p.receivedBytes))

    // The first progress report starts from what was already on disk.
    expect(first[0]).toBe(1000)
    expect(await manager.isInstalled(entry())).toBe(true)
  })

  it('starts over when the server ignores the resume request', async () => {
    await mkdir(manager.dirFor(entry()), { recursive: true })
    const partial = `${manager.pathFor(entry(), entry().files[0])}.partial`
    await writeFile(partial, PAYLOAD.subarray(0, 1000))

    // Appending a full body to an existing partial would corrupt the file.
    mode = 'ignore-range'
    await manager.download('test-model')

    const written = await readFile(manager.pathFor(entry(), entry().files[0]))
    expect(written.equals(PAYLOAD)).toBe(true)
  })

  it('discards a partial larger than the expected size', async () => {
    await mkdir(manager.dirFor(entry()), { recursive: true })
    const partial = `${manager.pathFor(entry(), entry().files[0])}.partial`
    await writeFile(partial, Buffer.alloc(PAYLOAD.length * 2, 1))

    await manager.download('test-model')
    const written = await readFile(manager.pathFor(entry(), entry().files[0]))
    expect(written.equals(PAYLOAD)).toBe(true)
  })

  it('refuses an unknown model rather than creating an empty directory', async () => {
    await expect(manager.download('nope')).rejects.toThrow(/unknown model/i)
  })

  it('refuses to download the same model twice at once', async () => {
    const first = manager.download('test-model')
    await expect(manager.download('test-model')).rejects.toThrow(/already downloading/i)
    await first
  })

  it('creates parent directories for files nested in subdirectories', async () => {
    // transformers.js resolves `onnx/encoder_model.onnx` literally under
    // localModelPath, so the upstream layout has to survive the download.
    const nested: CatalogEntry = {
      id: 'nested-model',
      kind: 'stt',
      label: 'Nested',
      description: 'Files inside a subdirectory',
      license: 'MIT',
      attribution: 'test',
      homepage: 'https://example.com',
      files: [
        {
          name: 'onnx/encoder_model.onnx',
          url: `${baseUrl}/encoder`,
          sha256: PAYLOAD_SHA,
          sizeBytes: PAYLOAD.length
        },
        {
          name: 'config.json',
          url: `${baseUrl}/config`,
          sha256: PAYLOAD_SHA,
          sizeBytes: PAYLOAD.length
        }
      ]
    }
    CATALOG.push(nested)

    await manager.download('nested-model')

    expect((await stat(join(manager.dirFor(nested), 'onnx', 'encoder_model.onnx'))).size).toBe(
      PAYLOAD.length
    )
    expect(await manager.isInstalled(nested)).toBe(true)
  })
})

describe('ModelManager state', () => {
  it('reports missing before download and installed after', async () => {
    expect((await manager.list())[0].state).toBe('missing')
    await manager.download('test-model')
    expect((await manager.list())[0].state).toBe('installed')
  })

  it('treats a truncated file as missing, not installed', async () => {
    await manager.download('test-model')
    await writeFile(manager.pathFor(entry(), entry().files[0]), 'short')

    // Otherwise the failure surfaces at model-load time, which is a far more
    // confusing place to discover it.
    expect(await manager.isInstalled(entry())).toBe(false)
  })

  it('removes an installed model', async () => {
    await manager.download('test-model')
    await manager.remove('test-model')
    expect(await manager.isInstalled(entry())).toBe(false)
  })

  it('cancels an in-flight download and cleans up', async () => {
    mode = 'truncate'
    const download = manager.download('test-model')
    await expect(download).rejects.toThrow()
    expect(await manager.isInstalled(entry())).toBe(false)
  })
})

describe('sha256Of', () => {
  it('matches the digest of the file contents', async () => {
    const file = join(root, 'sample.bin')
    await writeFile(file, PAYLOAD)
    expect(await sha256Of(file)).toBe(PAYLOAD_SHA)
  })
})

describe('catalog integrity', () => {
  it('gives every shipped entry a licence and attribution', async () => {
    // Restore the real catalog for this assertion.
    vi.resetModules()
    const { CATALOG: real } =
      await vi.importActual<typeof import('@shared/model-catalog')>('@shared/model-catalog')

    expect(real.length).toBeGreaterThan(0)
    for (const item of real) {
      expect(item.license, `${item.id} licence`).toBeTruthy()
      expect(item.attribution, `${item.id} attribution`).toBeTruthy()
      expect(item.homepage, `${item.id} homepage`).toMatch(/^https:\/\//)
      expect(item.files.length).toBeGreaterThan(0)
    }
  })
})
