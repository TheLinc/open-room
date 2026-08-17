import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Integration tests that spawn the voice sidecar and play real audio.
 *
 * Kept in a separate config so `npm test` stays fast and silent — these take
 * tens of seconds and make noise. Run with `npm run test:voice`, after a
 * build, since they execute the bundled sidecar.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Audio timings are real; the default 5s timeout is not survivable.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globals: false,
    // Sidecar processes and the audio device are shared, so parallel files
    // would interleave playback and make the overlap assertions meaningless.
    fileParallelism: false
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
