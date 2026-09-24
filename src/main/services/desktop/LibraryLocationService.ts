import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { findExistingLibraries, validateExistingLibrary } from '../filesystem/LibraryTransferService'

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
    if (choice.response === 1) {
      try {
        const root = await this.chooseExisting()
        if (root) this.remember(root)
        return root
      } catch (error) {
        await dialog.showMessageBox({ type: 'error', title: '无法打开 Library', message: error instanceof Error ? error.message : String(error) })
        return this.resolve()
      }
    }
    const selected = await dialog.showOpenDialog({ title: '选择 Muse Library 的保存位置', properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const root = join(selected.filePaths[0], 'Muse Library')
    this.remember(root)
    return root
  }

  remember(path: string): void {
    writeFileSync(this.statePath, JSON.stringify({ path }, null, 2), 'utf8')
  }

  async chooseExisting(): Promise<string | null> {
    const selected = await dialog.showOpenDialog({
      title: '选择 Library 或包含它的文件夹',
      buttonLabel: '查找 Library',
      properties: ['openDirectory']
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const selectedPath = selected.filePaths[0]
    const { paths, truncated } = await findExistingLibraries(selectedPath)
    if (truncated) throw new Error('所选文件夹范围太大，请选择更靠近备份的文件夹后重试')
    if (!paths.length) {
      const validation = validateExistingLibrary(selectedPath)
      if (!validation.valid && (existsSync(join(selectedPath, 'muse.db')) || existsSync(join(selectedPath, 'muse.sqlite3')))) {
        throw new Error(validation.message)
      }
      throw new Error('未在所选文件夹及下级目录找到完整的 Muse Library（需要 muse.db 和 originals 文件夹）')
    }
    if (paths.length === 1) return paths[0]!
    if (paths.length > 5) throw new Error(`找到 ${paths.length} 个 Muse Library，请选择更靠近目标备份的文件夹`)

    const choice = await dialog.showMessageBox({
      type: 'question',
      title: '找到多个 Muse Library',
      message: '请选择要打开的 Library',
      detail: paths.map((path, index) => `${index + 1}. ${path}`).join('\n\n'),
      buttons: [...paths.map((_, index) => `使用第 ${index + 1} 个`), '取消'],
      cancelId: paths.length,
      noLink: true
    })
    return choice.response === paths.length ? null : paths[choice.response]!
  }
}
