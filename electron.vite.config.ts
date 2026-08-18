import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // The voice sidecar is bundled alongside main but runs as its own
        // process, spawned with Electron's binary in Node mode.
        input: {
          index: resolve('src/main/index.ts'),
          voice: resolve('src/voice/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // The overlay window gets its own, much smaller bridge: it displays
        // state and reports what it observes, and has no reason to reach
        // agents, conversations or settings.
        input: {
          index: resolve('src/preload/index.ts'),
          overlay: resolve('src/preload/overlay.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        // `@` is what shadcn/ui generates imports against.
        // `@renderer` is kept for parity with the electron-vite scaffold.
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@overlay': resolve('src/overlay'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // Two documents, one renderer build. The overlay is a separate
        // window because push-to-talk is global and the main window is
        // usually backgrounded when someone talks.
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html')
        }
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
