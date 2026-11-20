import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'dotenv'

const shared = { '@shared': resolve('src/shared') }
// The three app keys are shared with downloads (decision 81); a user's own .env still wins.
const env = existsSync('.env') ? parse(readFileSync('.env')) : {}
const bundled = (name: string): string => JSON.stringify(env[name] ?? '')

export default defineConfig({
  main: {
    define: {
      'process.env.OVRA_BUNDLED_PRESAGE_API_KEY': bundled('PRESAGE_API_KEY'),
      'process.env.OVRA_BUNDLED_LASTFM_API_KEY': bundled('LASTFM_API_KEY'),
      'process.env.OVRA_BUNDLED_OPENROUTER_API_KEY': bundled('OPENROUTER_API_KEY')
    },
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
          capture: resolve('src/renderer/capture/index.html'),
          simulator: resolve('src/renderer/simulator/index.html'),
          monitor: resolve('src/renderer/monitor/index.html')
        }
      }
    }
  }
})
