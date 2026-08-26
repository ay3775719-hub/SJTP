import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const execFileAsync = promisify(execFile)
const HOST_NAME = 'com.muse.web_collector'
const EXTENSION_ORIGIN = 'chrome-extension://pammmlffogkfhnapajdjgelkkcpiijll/'

export async function registerNativeMessagingHost(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const directory = join(app.getPath('userData'), 'NativeMessaging')
  const manifestPath = join(directory, `${HOST_NAME}.json`)
  const hostPath = join(process.resourcesPath, 'native-host', 'MuseWebCollectorHost.exe')
  await mkdir(directory, { recursive: true })
  await writeFile(manifestPath, JSON.stringify({ name: HOST_NAME, description: 'Muse Web Collector Native Host', path: hostPath, type: 'stdio', allowed_origins: [EXTENSION_ORIGIN] }, null, 2), 'utf8')
  const keys = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`
  ]
  for (const key of keys) await execFileAsync('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { windowsHide: true })
}
