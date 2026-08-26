import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { validateExistingLibrary } from '../filesystem/LibraryTransferService'

interface LibraryState { path: string }

export class LibraryLocationService {
  private readonly statePath = join(app.getPath('userData'), 'library-state.json')

  async resolve(): Promise<string | null> {
    const overridden = process.env.MUSE_LIBRARY_PATH
    if (overridden) return overridden
    if (existsSync(this.statePath)) {
      try {
        const state = JSON.parse(readFileSync(this.statePath, 'utf8')) as LibraryState
        if (state.path && validateExistingLibrary(state.path).valid) return state.path
      } catch { /* prompt below */ }
    }

    const choice = await dialog.showMessageBox({
      type: 'question',
      title: '欢迎使用 Muse',
      message: '创建或打开 Muse Library',
      detail: '素材、缩略图与数据库都会保存在你选择的本地文件夹中。',
      buttons: ['创建 Muse Library', '选择已有 Library', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice.response === 2) return null
    const selected = await dialog.showOpenDialog({ title: choice.response === 0 ? '选择 Muse Library 的保存位置' : '选择已有 Muse Library', properties: choice.response === 0 ? ['openDirectory', 'createDirectory'] : ['openDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const root = choice.response === 0 ? join(selected.filePaths[0], 'Muse Library') : selected.filePaths[0]
    if (choice.response === 1) {
      const validation = validateExistingLibrary(root)
      if (!validation.valid) {
        await dialog.showMessageBox({ type: 'error', title: '无法打开 Library', message: validation.message, detail: '请选择包含 muse.db 和 originals 文件夹的完整 Muse Library。' })
        return this.resolve()
      }
    }
    this.remember(root)
    return root
  }

  remember(path: string): void {
    writeFileSync(this.statePath, JSON.stringify({ path }, null, 2), 'utf8')
  }

  async chooseExisting(): Promise<string | null> {
    const selected = await dialog.showOpenDialog({
      title: '选择已有 Muse Library',
      properties: ['openDirectory']
    })
    return selected.canceled ? null : (selected.filePaths[0] ?? null)
  }
}
