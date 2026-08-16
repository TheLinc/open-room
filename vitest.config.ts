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
    include: ['src/**/*.{test,spec}.ts'],
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
