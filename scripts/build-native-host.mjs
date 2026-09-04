import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const outputDir = join(root, 'release', 'native-host')
const compiler = process.env.WINDIR
  ? join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  : 'csc.exe'

await mkdir(outputDir, { recursive: true })
await compile('MuseWebCollectorHost.cs', 'MuseWebCollectorHost.exe')
await compile('MuseClipboardHost.cs', 'MuseClipboardHost.exe', ['/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll'])
await compile('MuseFileDragHost.cs', 'MuseFileDragHost.exe', ['/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll'], 'winexe')
await compile('MuseLatestLauncher.cs', 'MuseLatestLauncher.exe', ['/reference:System.Windows.Forms.dll'])

async function compile(sourceName, outputName, references = [], target = 'exe') {
  const source = join(root, 'native-host', sourceName)
  const output = join(outputDir, outputName)
  await new Promise((resolve, reject) => {
    const child = spawn(compiler, ['/nologo', `/target:${target}`, ...references, `/out:${output}`, source], { stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${outputName} compiler exited with ${code}`)))
  })
  console.log(`Muse native helper: ${output}`)
}
