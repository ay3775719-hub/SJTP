import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'design/branding/muse-icon-concept-v1.png'))
const output = join(root, 'build/icons')
await mkdir(output, { recursive: true })

const png = await sharp(source).resize(1024, 1024).png().toBuffer()
await writeFile(join(output, 'icon.png'), png)
const rendererAssets = join(root, 'src/renderer/src/assets')
await mkdir(rendererAssets, { recursive: true })
await sharp(source).resize(128, 128).png().toFile(join(rendererAssets, 'muse-icon.png'))

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()))
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16
  header[entry] = sizes[index] === 256 ? 0 : sizes[index]
  header[entry + 1] = header[entry]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(images[index].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += images[index].length
}
await writeFile(join(output, 'icon.ico'), Buffer.concat([header, ...images]))

const chunks = []
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const image = await sharp(source).resize(size, size).png().toBuffer()
  const chunk = Buffer.alloc(8)
  chunk.write(type, 0, 4, 'ascii')
  chunk.writeUInt32BE(image.length + 8, 4)
  chunks.push(chunk, image)
}
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 4, 'ascii')
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await writeFile(join(output, 'icon.icns'), Buffer.concat([icnsHeader, ...chunks]))
console.log('Muse branding generated: PNG, Windows ICO, macOS ICNS and renderer icon.')
