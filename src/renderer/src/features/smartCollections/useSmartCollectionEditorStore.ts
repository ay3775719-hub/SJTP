import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Asset, SmartCollectionInput, SmartCollectionRule } from '@shared/types/domain'
import { museApi } from '../../api/client'
import { useAssetStore } from '../../stores/useAssetStore'

interface EditorState {
  open: boolean
  editingId: string | null
  pendingDeleteId: string | null
  input: SmartCollectionInput
  previewCount: number
  previewAssets: Asset[]
  previewError: string | null
  saving: boolean
  openCreate(template?: SmartCollectionInput): void
  openEdit(id: string): void
  close(): void
  setName(name: string): void
  setMatchMode(matchMode: 'all' | 'any'): void
  replaceRule(id: string, rule: SmartCollectionRule): void
  addRule(): void
  removeRule(id: string): void
  preview(): Promise<void>
  save(): Promise<void>
  requestDelete(id: string): void
  cancelDelete(): void
  confirmDelete(): Promise<void>
}

const blankRule = (): SmartCollectionRule => ({ id: nanoid(10), field: 'extension', operator: 'equals', value: 'png' })
const blankInput = (): SmartCollectionInput => ({ name: '', matchMode: 'all', rules: [blankRule()] })

export const useSmartCollectionEditorStore = create<EditorState>((set, get) => ({
  open: false, editingId: null, pendingDeleteId: null, input: blankInput(), previewCount: 0, previewAssets: [], previewError: null, saving: false,
  openCreate: (template) => set({ open: true, editingId: null, input: template ?? blankInput(), previewCount: 0, previewAssets: [], previewError: null }),
  openEdit: (id) => {
    const collection = useCollection(id)
    if (collection) set({ open: true, editingId: id, input: { name: collection.name, matchMode: collection.matchMode, rules: collection.rules }, previewCount: collection.assetCount, previewAssets: [], previewError: collection.invalidRuleIds.length ? '部分规则引用的数据已不存在' : null })
  },
  close: () => set({ open: false, editingId: null, previewError: null }),
  setName: (name) => set((state) => ({ input: { ...state.input, name } })),
  setMatchMode: (matchMode) => set((state) => ({ input: { ...state.input, matchMode } })),
  replaceRule: (id, rule) => set((state) => ({ input: { ...state.input, rules: state.input.rules.map((item) => item.id === id ? rule : item) } })),
  addRule: () => set((state) => ({ input: { ...state.input, rules: [...state.input.rules, blankRule()] } })),
  removeRule: (id) => set((state) => ({ input: { ...state.input, rules: state.input.rules.filter((rule) => rule.id !== id) } })),
  preview: async () => {
    try { const page = await museApi.smartCollections.preview(get().input); set({ previewCount: page.total, previewAssets: page.items, previewError: null }) }
    catch (error) { set({ previewCount: 0, previewAssets: [], previewError: error instanceof Error ? error.message : String(error) }) }
  },
  save: async () => {
    const { input, editingId } = get()
    if (!input.name.trim() || !input.rules.length) return
    set({ saving: true })
    try {
      const collection = editingId ? await museApi.smartCollections.update(editingId, input) : await museApi.smartCollections.create(input)
      set({ open: false, editingId: null })
      await useAssetStore.getState().setQuery({ smartCollectionId: collection.id, folderId: undefined, tagIds: undefined, favorite: undefined, deleted: false, recent: undefined })
    }
    finally { set({ saving: false }) }
  },
  requestDelete: (pendingDeleteId) => set({ pendingDeleteId }),
  cancelDelete: () => set({ pendingDeleteId: null }),
  confirmDelete: async () => { const id = get().pendingDeleteId; if (!id) return; await museApi.smartCollections.remove(id); set({ pendingDeleteId: null, open: false, editingId: null }) }
}))

function useCollection(id: string) {
  return useAssetStore.getState().bootstrap?.smartCollections.find((collection) => collection.id === id) ?? null
}
