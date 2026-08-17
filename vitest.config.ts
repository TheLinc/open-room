import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Tests cover the pure logic that carries this app's real complexity —
 * the SpeechBus, voice resolution, wake/phonetic matching, and config schemas.
 * None of it needs Electron, so tests run in plain Node with no browser env.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // `scripts/` is covered too: build tooling that rewrites source or records
    // checksums is exactly the kind of thing that should not be trusted
    // untested, even though it never ships.
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
    // Integration tests spawn the voice sidecar and play real audio, so they
    // are opt-in via `npm run test:voice` rather than part of every run.
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    globals: false
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main')
    }
  }
})
