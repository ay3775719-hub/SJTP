import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(projectRoot, 'vendor', 'codex', 'win32-x64')
const required = ['codex.exe', 'codex-code-mode-host.exe']
const optional = ['codex-command-runner.exe', 'codex-windows-sandbox-setup.exe']
const candidates = [
  process.env.MUSE_CODEX_RUNTIME_DIR,
  process.env.USERPROFILE ? join(process.env.USERPROFILE, '.codex', 'plugins', '.plugin-appserver') : null,
  destination
].filter(Boolean)

const exists = async (path) => { try { await stat(path); return true } catch { return false } }
let source = null
for (const candidate of candidates) {
  if ((await Promise.all(required.map((name) => exists(join(candidate, name))))).every(Boolean)) { source = candidate; break }
}
if (!source) {
  throw new Error('Complete Codex runtime not found. Install/update Codex Desktop or set MUSE_CODEX_RUNTIME_DIR.')
}

await mkdir(destination, { recursive: true })
for (const name of [...required, ...optional]) {
  const from = join(source, name), to = join(destination, name)
  if (from === to || !await exists(from)) continue
  await copyFile(from, to)
}
console.log(`Prepared complete Codex runtime from ${source}`)
