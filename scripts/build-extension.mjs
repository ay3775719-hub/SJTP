import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd(), source = join(root, 'browser-extension'), output = join(root, 'release', 'browser-extension')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(source, output, { recursive: true })
console.log(`Muse Web Collector extension: ${output}`)
