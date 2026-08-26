import type { MuseAgentContextSnapshot } from '@shared/types/domain'

const EMPTY_CONTEXT: MuseAgentContextSnapshot = {
  currentViewType: 'library', currentViewId: null, selectionCount: 0, selectedAssetIds: [], focusedAssetId: null
}

export class MuseAgentContextService {
  private snapshot: MuseAgentContextSnapshot = EMPTY_CONTEXT

  update(snapshot: MuseAgentContextSnapshot): void {
    this.snapshot = { ...snapshot, selectedAssetIds: [...snapshot.selectedAssetIds] }
  }

  current(): MuseAgentContextSnapshot {
    return { ...this.snapshot, selectedAssetIds: [...this.snapshot.selectedAssetIds] }
  }
}
