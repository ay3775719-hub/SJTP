import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('src/renderer'),
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: ['terminal.local']
  },
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }
  },
  plugins: [react()]
})
