import { GalleryToolbar } from './GalleryToolbar'
import { GalleryZoomControl } from './GalleryZoomControl'
import { VirtualizedMasonry } from './VirtualizedMasonry'
import { useAssetStore } from '../../stores/useAssetStore'
import { NaturalSearchSummary } from '../search/NaturalSearchSummary'
import { useNaturalSearchStore } from '../../stores/useNaturalSearchStore'
import { useDuplicateStore } from '../../stores/useDuplicateStore'
import { DuplicatePage } from '../duplicates/DuplicatePage'

export function Gallery(): React.JSX.Element {
  const similarity = useAssetStore((state) => state.similarity)
  const duplicatesOpen = useDuplicateStore((state) => state.open)
  const hasSearchSummary = useNaturalSearchStore((state) => !similarity && Boolean(state.intent || state.warning || state.parsing))
  if (duplicatesOpen) return <DuplicatePage />
  return (
    <main className={`asset-workspace ${hasSearchSummary ? 'has-search-summary' : ''}`}>
      <GalleryToolbar />
      {!similarity && <NaturalSearchSummary />}
      <VirtualizedMasonry />
      <GalleryZoomControl placement="bottom" />
    </main>
  )
}
