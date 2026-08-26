import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdtemp, cp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { env, pipeline } from '@huggingface/transformers'

const databasePath = process.env.MUSE_DB
const modelRoot = process.env.MUSE_VISUAL_MODEL_ROOT
const outputPath = process.env.MUSE_DUPLICATE_REPORT
if (!databasePath || !modelRoot || !outputPath) throw new Error('MUSE_DB, MUSE_VISUAL_MODEL_ROOT and MUSE_DUPLICATE_REPORT are required')
const db = new DatabaseSync(databasePath, { readOnly: true })
const selected = ['f5dJ_0jBKBU1YSZh', 'ixQP97Ytj4wQR_QE', 'ErAH6PUfzb2BNTXv']
const rows = db.prepare(`SELECT id,filename,path,width,height FROM assets WHERE id IN (?,?,?)`).all(...selected)
db.close()
const byId = new Map(rows.map((row) => [row.id, row]))
const base = byId.get(selected[0]), sameProductDifferentView = byId.get(selected[1]), differentContent = byId.get(selected[2])
if (!base || !sameProductDifferentView || !differentContent) throw new Error('Quality assets are unavailable')
const root = await mkdtemp(join(tmpdir(), 'muse-duplicate-quality-'))
try {
  const metadata = await sharp(base.path).metadata(), width = metadata.autoOrient.width ?? metadata.width, height = metadata.autoOrient.height ?? metadata.height
  const variants = [
    { name: 'exact-copy', expected: 'exact', path: join(root, 'exact.png'), source: base.path },
    { name: 'renamed-exact-copy', expected: 'exact', path: join(root, 'renamed.png'), source: base.path },
    { name: 'jpeg-recompression', expected: 'near', path: join(root, 'recompressed.jpg'), make: (path) => sharp(base.path).rotate().jpeg({ quality: 58 }).toFile(path) },
    { name: 'png-to-jpeg', expected: 'near', path: join(root, 'converted.jpg'), make: (path) => sharp(base.path).rotate().flatten({ background: '#fff' }).jpeg({ quality: 90 }).toFile(path) },
    { name: 'resize-50-percent', expected: 'near', path: join(root, 'resized.jpg'), make: (path) => sharp(base.path).rotate().resize(Math.max(32, Math.round(width / 2))).jpeg({ quality: 88 }).toFile(path) },
    { name: 'crop-3-percent', expected: 'near', path: join(root, 'crop.jpg'), make: (path) => sharp(base.path).rotate().extract({ left: Math.round(width * .03), top: Math.round(height * .03), width: Math.round(width * .94), height: Math.round(height * .94) }).jpeg({ quality: 88 }).toFile(path) },
    { name: 'light-color-adjustment', expected: 'near', path: join(root, 'color.jpg'), make: (path) => sharp(base.path).rotate().modulate({ brightness: 1.06, saturation: .9 }).jpeg({ quality: 86 }).toFile(path) },
    { name: 'small-watermark', expected: 'near', path: join(root, 'watermark.jpg'), make: (path) => sharp(base.path).rotate().composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><text x="${Math.round(width * .76)}" y="${Math.round(height * .92)}" fill="white" opacity=".72" font-size="${Math.max(18, Math.round(width * .025))}">MUSE</text></svg>`) }]).jpeg({ quality: 88 }).toFile(path) },
    { name: 'same-product-different-view', expected: 'similar-only', path: sameProductDifferentView.path, source: sameProductDifferentView.path },
    { name: 'different-content-similar-portrait-layout', expected: 'similar-only', path: differentContent.path, source: differentContent.path }
  ]
  for (const variant of variants) variant.make ? await variant.make(variant.path) : variant.path !== variant.source && await cp(variant.source, variant.path)
  env.localModelPath = modelRoot; env.allowLocalModels = true; env.allowRemoteModels = false
  const embedder = await pipeline('image-feature-extraction', 'dinov2-small', { dtype: 'q8', local_files_only: true, session_options: { executionProviders: ['cpu'], intraOpNumThreads: 4 } })
  const baseVector = normalize((await embedder(base.path)).data.slice(0, 384)), baseHash = await pHash(base.path), baseContent = await sha256(base.path)
  const results = []
  for (const variant of variants) {
    const started = performance.now(), vector = normalize((await embedder(variant.path)).data.slice(0, 384)), visualSimilarity = dot(baseVector, vector)
    const hash = await pHash(variant.path), pHashDistance = distance(baseHash, hash), info = await sharp(variant.path).metadata()
    const aspect = aspectScore({ width, height }, { width: info.autoOrient.width ?? info.width, height: info.autoOrient.height ?? info.height })
    const dimensions = dimensionScore({ width, height }, { width: info.autoOrient.width ?? info.width, height: info.autoOrient.height ?? info.height })
    const pScore = Math.max(0, 1 - pHashDistance / 24), duplicateScore = .58 * visualSimilarity + .27 * pScore + .1 * aspect + .05 * dimensions
    const exact = baseContent === await sha256(variant.path), near = duplicateScore >= .9 && aspect >= .88 && ((pHashDistance <= 10 && visualSimilarity >= .88) || (pHashDistance <= 16 && visualSimilarity >= .94))
    results.push({ case: variant.name, expected: variant.expected, detected: exact ? 'exact' : near ? 'near' : 'similar-only', visualSimilarity: round(visualSimilarity), pHashDistance, aspectRatioScore: round(aspect), dimensionScore: round(dimensions), duplicateScore: round(duplicateScore), elapsedMs: round(performance.now() - started) })
  }
  await embedder.dispose()
  const nearExpected = results.filter((item) => item.expected === 'near'), truePositive = nearExpected.filter((item) => item.detected === 'near').length
  const negatives = results.filter((item) => item.expected === 'similar-only'), falsePositive = negatives.filter((item) => item.detected === 'near').length
  const detectedNear = results.filter((item) => item.detected === 'near').length
  const report = { generatedAt: new Date().toISOString(), sourceAsset: { id: base.id, filename: base.filename }, model: 'dinov2-small-q8', thresholdVersion: 'conservative-v1', cases: results, metrics: { exactPrecision: 1, nearTruePositive: truePositive, nearFalseNegative: nearExpected.length - truePositive, falsePositive, nearPrecision: detectedNear ? truePositive / detectedNear : 1 } }
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }

async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }
function normalize(input) { const vector = Float32Array.from(input), magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)); for (let i = 0; i < vector.length; i += 1) vector[i] /= magnitude; return vector }
function dot(a, b) { let sum = 0; for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]; return sum }
function aspectScore(a, b) { const x = a.width / a.height, y = b.width / b.height; return Math.min(x, y) / Math.max(x, y) }
function dimensionScore(a, b) { return Math.sqrt(Math.min(a.width * a.height, b.width * b.height) / Math.max(a.width * a.height, b.width * b.height)) }
function distance(a, b) { let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), result = 0; while (value) { result += Number(value & 1n); value >>= 1n } return result }
function round(value) { return Math.round(value * 10000) / 10000 }
async function pHash(path) { const size = 32, low = 8, data = await sharp(path).rotate().flatten({ background: '#fff' }).greyscale().resize(size, size, { fit: 'fill' }).raw().toBuffer(), values = []; for (let v = 0; v < low; v += 1) for (let u = 0; u < low; u += 1) { let sum = 0; for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) sum += data[y * size + x] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)) * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size)); values.push(sum) } const sorted = values.slice(1).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)]; let bits = 0n; values.forEach((value, index) => { if (value >= median) bits |= 1n << BigInt(63 - index) }); return bits.toString(16).padStart(16, '0') }
