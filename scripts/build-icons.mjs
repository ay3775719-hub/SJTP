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
// Traditional bitmap entries let Explorer and older icon readers load every
// size without depending on PNG support inside ICO files.
const images = await Promise.all(sizes.map(async size => {
  const rgba = await sharp(source).resize(size, size).ensureAlpha().raw().toBuffer()
  const pixels = Buffer.alloc(size * size * 4)
  const maskStride = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskStride * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sourceOffset = (y * size + x) * 4
      const targetOffset = ((size - 1 - y) * size + x) * 4
      pixels[targetOffset] = rgba[sourceOffset + 2]
      pixels[targetOffset + 1] = rgba[sourceOffset + 1]
      pixels[targetOffset + 2] = rgba[sourceOffset]
      pixels[targetOffset + 3] = rgba[sourceOffset + 3]
      if (rgba[sourceOffset + 3] === 0) mask[(size - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  const bitmapHeader = Buffer.alloc(40)
  bitmapHeader.writeUInt32LE(40, 0)
  bitmapHeader.writeInt32LE(size, 4)
  bitmapHeader.writeInt32LE(size * 2, 8)
  bitmapHeader.writeUInt16LE(1, 12)
  bitmapHeader.writeUInt16LE(32, 14)
  bitmapHeader.writeUInt32LE(pixels.length + mask.length, 20)
  return Buffer.concat([bitmapHeader, pixels, mask])
}))
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
