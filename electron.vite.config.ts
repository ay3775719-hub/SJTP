import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const alias = { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'workers/embeddingWorker': resolve('src/main/workers/embeddingWorker.ts'),
          'workers/semanticSearchWorker': resolve('src/main/workers/semanticSearchWorker.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias },
    plugins: [react()]
  }
})
