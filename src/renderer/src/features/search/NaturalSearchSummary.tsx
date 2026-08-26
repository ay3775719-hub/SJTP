import { FloppyDisk, Sparkle, X } from '@phosphor-icons/react'
import { useState } from 'react'
import { useNaturalSearchStore } from '../../stores/useNaturalSearchStore'

export function NaturalSearchSummary(): React.JSX.Element | null {
  const intent = useNaturalSearchStore((state) => state.intent)
  const chips = useNaturalSearchStore((state) => state.chips)
  const warning = useNaturalSearchStore((state) => state.warning)
  const parsing = useNaturalSearchStore((state) => state.parsing)
  const canSave = useNaturalSearchStore((state) => state.canSave)
  const unAnalyzedCount = useNaturalSearchStore((state) => state.unAnalyzedCount)
  const removeChip = useNaturalSearchStore((state) => state.removeChip)
  const save = useNaturalSearchStore((state) => state.saveAsSmartCollection)
  const [notice, setNotice] = useState<string | null>(null)
  if (!intent && !warning && !parsing) return null
  return <div className="natural-search-summary">
    <div className="natural-search-chips">
      {parsing && <span className="search-understanding"><Sparkle size={12} />正在理解搜索条件…</span>}
      {chips.map((chip) => <button key={chip.signature} className={chip.negative ? 'negative' : ''} onClick={() => void removeChip(chip.signature)} title="移除此条件">
        {chip.negative ? '排除 · ' : ''}{chip.label}<X size={10} />
      </button>)}
      {warning && <span className="natural-search-warning">{warning}</span>}
      {unAnalyzedCount > 0 && intent && <span className="search-unanalysed">{unAnalyzedCount} 张素材尚未 AI 分析</span>}
      {notice && <span className="search-save-notice">✓ 已创建“{notice}”</span>}
    </div>
    {intent && <button className="save-natural-search" disabled={!canSave} title={canSave ? '保存为动态智能集合' : '嵌套条件暂不能无损保存'} onClick={() => void save().then((name) => name && setNotice(name))}><FloppyDisk size={13} />保存为智能集合</button>}
  </div>
}
