import { app, clipboard, nativeImage, type WebContents } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ClipboardCopyResult {
  count: number
  mode: 'image-and-files' | 'files' | 'image' | 'paths'
}

export class ClipboardService {
  private activeFileDrag: ChildProcess | null = null

  async copyAssetPaths(paths: string[]): Promise<ClipboardCopyResult> {
    const unique = [...new Set(paths.filter((path) => existsSync(path)))]
    if (!unique.length) throw new Error('No readable asset files selected')

    if (process.platform === 'win32') {
      const helper = this.helperPath('MuseClipboardHost.exe')
      if (existsSync(helper)) {
        await runWindowsClipboardHelper(helper, unique)
        return { count: unique.length, mode: unique.length === 1 ? 'image-and-files' : 'files' }
      }
    }

    if (unique.length === 1) {
      const image = nativeImage.createFromPath(unique[0]!)
      if (!image.isEmpty()) {
        clipboard.writeImage(image)
        return { count: 1, mode: 'image' }
      }
    }
    clipboard.writeText(unique.join('\n'))
    return { count: unique.length, mode: 'paths' }
  }

  startAssetDrag(contents: WebContents, paths: string[]): void {
    const unique = [...new Set(paths.filter((path) => existsSync(path)))]
    if (!unique.length) throw new Error('No readable asset files selected')

    if (process.platform === 'win32') {
      const helper = this.helperPath('MuseFileDragHost.exe')
      if (existsSync(helper)) {
        this.activeFileDrag?.kill()
        const child = runWindowsFileDragHelper(helper, unique)
        this.activeFileDrag = child
        child.once('exit', () => {
          if (this.activeFileDrag === child) this.activeFileDrag = null
        })
        return
      }
    }

    const thumbnail = nativeImage.createFromPath(unique[0]!).resize({ width: 96, quality: 'good' })
    contents.startDrag({ file: unique[0]!, files: unique, icon: thumbnail.isEmpty() ? unique[0]! : thumbnail })
  }

  private helperPath(name: string): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'native-host', name)
      : join(process.cwd(), 'release', 'native-host', name)
  }
}

function runWindowsClipboardHelper(executable: string, paths: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Clipboard helper timed out')) }, 10_000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `Clipboard helper exited with ${code ?? 'unknown'}`))
    })
    child.stdin.end(paths.map((path) => Buffer.from(path, 'utf8').toString('base64')).join('\n'))
  })
}

function runWindowsFileDragHelper(executable: string, paths: string[]): ChildProcess {
  // This helper owns a small native drag surface. Hiding its initial window also
  // hides that surface on Windows, leaving the renderer with nothing to drag.
  const encodedPaths = paths.map((path) => Buffer.from(path, 'utf8').toString('base64'))
  const child = spawn(executable, encodedPaths, { stdio: 'ignore', windowsHide: false })
  const timer = setTimeout(() => child.kill(), 300_000)
  child.on('error', () => undefined)
  child.once('exit', () => clearTimeout(timer))
  return child
}
