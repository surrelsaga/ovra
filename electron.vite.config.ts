import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // Bundle each preload on its own (sandboxed preloads can't require node_modules).
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          capture: resolve('src/preload/capture.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer') }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          'main-window': resolve('src/renderer/main-window/index.html'),
          orb: resolve('src/renderer/orb/index.html'),
          'move-card': resolve('src/renderer/move-card/index.html'),
          capture: resolve('src/renderer/capture/index.html')
        }
      }
    }
  }
})
