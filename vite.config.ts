import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * This file exists so the shadcn CLI can detect the project as a Vite app —
 * it looks for `vite.config.ts` and does not recognise `electron.vite.config.ts`.
 * Without it, `npx shadcn@latest init/add` fails with "could not detect a
 * supported framework".
 *
 * The actual build is driven by `electron.vite.config.ts`. Keep the renderer
 * settings here in sync with that file's `renderer` section.
 */
export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react(), tailwindcss()]
})
