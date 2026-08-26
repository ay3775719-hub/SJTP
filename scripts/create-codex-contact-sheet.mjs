import sharp from 'sharp'
import { DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const databasePath = process.env.MUSE_DB_PATH
if (!databasePath) throw new Error('MUSE_DB_PATH is required')
const output = process.env.MUSE_CONTACT_SHEET || join(process.cwd(), 'design-qa-artifacts', 'codex-batch20-contact-sheet.jpg')
const db = new DatabaseSync(databasePath, { readOnly: true })
const assets = db.prepare('SELECT id,path,filename FROM assets ORDER BY imported_at,id LIMIT 20').all()
db.close()
const cellWidth = 300, cellHeight = 250, columns = 4, rows = 5
const composites = []
for (let index = 0; index < assets.length; index += 1) {
  const asset = assets[index]
  const image = await sharp(asset.path).rotate().resize({ width: 276, height: 194, fit: 'contain', background: '#16181c' }).jpeg({ quality: 82 }).toBuffer()
  const x = (index % columns) * cellWidth + 12, y = Math.floor(index / columns) * cellHeight + 12
  composites.push({ input: image, left: x, top: y })
  const label = Buffer.from(`<svg width="276" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="276" height="32" fill="#1d2025"/><text x="8" y="21" fill="#f0f1f3" font-family="Arial, Microsoft YaHei" font-size="14">${index + 1}. ${escapeXml(asset.filename).slice(0, 31)}</text></svg>`)
  composites.push({ input: label, left: x, top: y + 198 })
}
await mkdir(join(process.cwd(), 'design-qa-artifacts'), { recursive: true })
await sharp({ create: { width: columns * cellWidth, height: rows * cellHeight, channels: 3, background: '#101216' } }).composite(composites).jpeg({ quality: 90 }).toFile(output)
process.stdout.write(`${output}\n`)

function escapeXml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]) }
