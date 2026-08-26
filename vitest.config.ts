import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('.'),
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] }
})
