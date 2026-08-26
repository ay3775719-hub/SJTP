import { useEffect, useState } from 'react'
import { Plus, Trash, WarningCircle, X } from '@phosphor-icons/react'
import { nanoid } from 'nanoid'
import type { AISmartCollectionSuggestion, Folder, SmartCollectionField, SmartCollectionInput, SmartCollectionRule, Tag } from '@shared/types/domain'
import { useAssetStore } from '../../stores/useAssetStore'
import { useSmartCollectionEditorStore } from './useSmartCollectionEditorStore'
import { museApi } from '../../api/client'

const fields: Array<{ value: SmartCollectionField; label: string; group: string }> = [
  { value: 'filename', label: '文件名', group: '文件信息' }, { value: 'extension', label: '格式', group: '文件信息' }, { value: 'width', label: '宽度', group: '文件信息' }, { value: 'height', label: '高度', group: '文件信息' }, { value: 'orientation', label: '宽高比', group: '文件信息' }, { value: 'size', label: '文件大小', group: '文件信息' },
  { value: 'favorite', label: '收藏', group: 'Library' }, { value: 'folder', label: '文件夹', group: 'Library' }, { value: 'tag', label: '标签', group: 'Library' }, { value: 'importedAt', label: '导入时间', group: 'Library' }, { value: 'createdAt', label: '创建时间', group: 'Library' }, { value: 'lastOpenedAt', label: '最近使用时间', group: 'Library' },
  { value: 'sourceType', label: '来源类型', group: '来源' }, { value: 'sourceDomain', label: '来源网站', group: '来源' },
  { value: 'aiObject', label: '对象', group: 'AI' }, { value: 'aiScene', label: '场景', group: 'AI' }, { value: 'aiStyle', label: '风格', group: 'AI' },
  { value: 'colorHex', label: '包含颜色', group: '颜色' }, { value: 'colorTemperature', label: '色温', group: '颜色' }, { value: 'colorBrightness', label: '亮度', group: '颜色' }, { value: 'colorSaturation', label: '饱和度', group: '颜色' }
]

const textOps = [['contains', '包含'], ['notContains', '不包含'], ['equals', '等于'], ['notEquals', '不等于'], ['startsWith', '开头是'], ['endsWith', '结尾是']] as const
const numberOps = [['equals', '等于'], ['gt', '大于'], ['gte', '大于等于'], ['lt', '小于'], ['lte', '小于等于'], ['between', '区间']] as const
const relationOps = [['is', '是'], ['isNot', '不是'], ['contains', '包含'], ['notContains', '不包含']] as const
const dateOps = [['today', '今天'], ['last7', '最近 7 天'], ['last30', '最近 30 天'], ['last90', '最近 90 天'], ['before', '早于'], ['after', '晚于'], ['between', '介于']] as const

const templates: Array<{ label: string; input: SmartCollectionInput }> = [
  { label: '最近添加', input: { name: '最近添加', matchMode: 'all', rules: [{ id: 'template-recent', field: 'importedAt', operator: 'last30', value: null }] } },
  { label: '收藏', input: { name: '收藏', matchMode: 'all', rules: [{ id: 'template-favorite', field: 'favorite', operator: 'is', value: true }] } },
  { label: '大尺寸图片', input: { name: '大尺寸图片', matchMode: 'any', rules: [{ id: 'template-wide', field: 'width', operator: 'gte', value: 3000 }, { id: 'template-tall', field: 'height', operator: 'gte', value: 3000 }] } },
  { label: '竖版图片', input: { name: '竖版图片', matchMode: 'all', rules: [{ id: 'template-portrait', field: 'orientation', operator: 'is', value: 'portrait' }] } },
  { label: '横版图片', input: { name: '横版图片', matchMode: 'all', rules: [{ id: 'template-landscape', field: 'orientation', operator: 'is', value: 'landscape' }] } },
  { label: 'PNG 图片', input: { name: 'PNG 图片', matchMode: 'all', rules: [{ id: 'template-png', field: 'extension', operator: 'equals', value: 'png' }] } }
]

export function SmartCollectionEditor(): React.JSX.Element | null {
  const store = useSmartCollectionEditorStore()
  const bootstrap = useAssetStore((state) => state.bootstrap)
  const [suggestions, setSuggestions] = useState<AISmartCollectionSuggestion[]>([])
  useEffect(() => {
    if (!store.open) return
    const timer = window.setTimeout(() => { void useSmartCollectionEditorStore.getState().preview() }, 220)
    return () => window.clearTimeout(timer)
  }, [store.open, store.input])
  useEffect(() => { if (store.open && !store.editingId) void museApi.ai.suggestions().then(setSuggestions) }, [store.open, store.editingId])
  if (!store.open || !bootstrap) return null
  const duplicateName = bootstrap.smartCollections.some((collection) => collection.id !== store.editingId && collection.name.toLocaleLowerCase() === store.input.name.trim().toLocaleLowerCase())
  return (
    <div className="smart-modal-backdrop">
      <section className="smart-modal" role="dialog" aria-modal="true" aria-labelledby="smart-title">
        <header><div><h2 id="smart-title">{store.editingId ? '编辑智能集合' : '创建智能集合'}</h2><p>智能集合是实时查询，不会复制或移动素材。</p></div><button onClick={store.close} aria-label="关闭"><X size={18} /></button></header>
        <div className="smart-modal-scroll">
          {!store.editingId && <><div className="smart-templates"><span>快速开始</span>{templates.map((template) => <button key={template.label} onClick={() => store.openCreate({ ...template.input, rules: template.input.rules.map((rule) => ({ ...rule, id: nanoid(10) })) })}>{template.label}</button>)}</div>{suggestions.length > 0 && <div className="smart-templates ai-suggestions"><span>基于真实 AI 数据</span>{suggestions.map((suggestion) => <button key={`${suggestion.type}:${suggestion.normalizedValue}`} onClick={() => store.openCreate({ name: suggestion.value, matchMode: 'all', rules: [{ id: nanoid(10), field: suggestion.field, operator: 'contains', value: suggestion.value }] })}>{suggestion.value} <b>{suggestion.assetCount}</b></button>)}</div>}</>}
          <label className="smart-field-label"><span>名称</span><input autoFocus value={store.input.name} onChange={(event) => store.setName(event.target.value)} placeholder="例如：收藏的 PNG" maxLength={120} />{duplicateName && <small><WarningCircle size={13} />已经存在同名智能集合，仍可继续创建。</small>}</label>
          <fieldset className="match-mode"><legend>匹配方式</legend><label><input type="radio" checked={store.input.matchMode === 'all'} onChange={() => store.setMatchMode('all')} /> 满足所有规则</label><label><input type="radio" checked={store.input.matchMode === 'any'} onChange={() => store.setMatchMode('any')} /> 满足任意规则</label></fieldset>
          <div className="rules-heading"><strong>规则</strong><span>{store.input.matchMode === 'all' ? 'AND' : 'OR'}</span></div>
          <div className="smart-rules">{store.input.rules.map((rule) => <RuleRow key={rule.id} rule={rule} folders={bootstrap.folders} tags={bootstrap.tags} onChange={(next) => store.replaceRule(rule.id, next)} onRemove={() => store.removeRule(rule.id)} canRemove={store.input.rules.length > 1} />)}</div>
          <button className="add-rule" onClick={store.addRule}><Plus size={15} />添加规则</button>
          <div className="smart-preview"><div><span>实时预览</span><strong>{store.previewError ? '规则需要修正' : `当前匹配 ${store.previewCount.toLocaleString('zh-CN')} 项素材`}</strong></div>{store.previewError && <p><WarningCircle size={14} />{store.previewError}</p>}<div className="smart-preview-images">{store.previewAssets.map((asset) => <img key={asset.id} src={asset.thumbnailUrl} alt="" />)}</div></div>
        </div>
        <footer><button onClick={store.close}>取消</button><button className="primary" disabled={!store.input.name.trim() || !store.input.rules.length || Boolean(store.previewError) || store.saving} onClick={() => void store.save()}>{store.saving ? '正在保存…' : store.editingId ? '保存修改' : '创建智能集合'}</button></footer>
      </section>
    </div>
  )
}

function RuleRow({ rule, folders, tags, onChange, onRemove, canRemove }: { rule: SmartCollectionRule; folders: Folder[]; tags: Tag[]; onChange(rule: SmartCollectionRule): void; onRemove(): void; canRemove: boolean }): React.JSX.Element {
  const changeField = (field: SmartCollectionField): void => onChange(defaultRule(rule.id, field, folders, tags))
  const missingRelation = (rule.field === 'folder' && !folders.some((folder) => folder.id === rule.value)) || (rule.field === 'tag' && !tags.some((tag) => tag.id === rule.value))
  const groups = [...new Set(fields.map((field) => field.group))]
  return <div className={`smart-rule-row ${missingRelation ? 'invalid' : ''}`}><select value={rule.field} onChange={(event) => changeField(event.target.value as SmartCollectionField)}>{groups.map((group) => <optgroup key={group} label={group}>{fields.filter((field) => field.group === group).map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</optgroup>)}</select><OperatorInput rule={rule} onChange={onChange} /><ValueInput rule={rule} folders={folders} tags={tags} onChange={onChange} /><button className="remove-rule" disabled={!canRemove} onClick={onRemove} title="删除规则"><Trash size={15} /></button>{missingRelation && <small>该{rule.field === 'folder' ? '文件夹' : '标签'}已不存在</small>}</div>
}

function OperatorInput({ rule, onChange }: { rule: SmartCollectionRule; onChange(rule: SmartCollectionRule): void }): React.JSX.Element {
  const options = rule.field.startsWith('ai') || ['filename', 'extension', 'sourceDomain', 'sourceType'].includes(rule.field) ? textOps : ['width', 'height', 'size','colorBrightness','colorSaturation'].includes(rule.field) ? numberOps : ['folder', 'tag'].includes(rule.field) ? relationOps : ['importedAt', 'createdAt', 'lastOpenedAt'].includes(rule.field) ? dateOps : rule.field === 'colorHex' ? [['near','接近']] as const : rule.field === 'orientation' || rule.field === 'colorTemperature' ? [['is', '是'], ['isNot', '不是']] as const : [['is', '等于']] as const
  return <select value={rule.operator} onChange={(event) => onChange(withOperator(rule, event.target.value))}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
}

function ValueInput({ rule, folders, tags, onChange }: { rule: SmartCollectionRule; folders: Folder[]; tags: Tag[]; onChange(rule: SmartCollectionRule): void }): React.JSX.Element {
  if (rule.field === 'favorite') return <select value={String(rule.value)} onChange={(event) => onChange({ ...rule, value: event.target.value === 'true' })}><option value="true">是</option><option value="false">否</option></select>
  if (rule.field === 'orientation') return <select value={rule.value} onChange={(event) => onChange({ ...rule, value: event.target.value as 'landscape' | 'portrait' | 'square' })}><option value="landscape">横版</option><option value="portrait">竖版</option><option value="square">方形</option></select>
  if (rule.field === 'colorTemperature') return <select value={rule.value} onChange={(event) => onChange({ ...rule, value: event.target.value as 'cool' | 'neutral' | 'warm' })}><option value="cool">冷色</option><option value="neutral">中性</option><option value="warm">暖色</option></select>
  if (rule.field === 'colorHex') return <input type="color" value={rule.value} onChange={(event) => onChange({ ...rule, value: event.target.value })} />
  if (rule.field === 'folder' || rule.field === 'tag') { const items = rule.field === 'folder' ? folders : tags; return <select value={rule.value} onChange={(event) => onChange({ ...rule, value: event.target.value })}>{!items.length && <option value="">暂无可选项</option>}{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> }
  if (['importedAt', 'createdAt', 'lastOpenedAt'].includes(rule.field)) {
    if (['today', 'last7', 'last30', 'last90'].includes(rule.operator)) return <span className="rule-no-value">自动计算</span>
    if (rule.operator === 'between' && rule.value && typeof rule.value === 'object' && 'from' in rule.value) return <div className="range-input"><input type="date" value={rule.value.from} onChange={(event) => onChange({ ...rule, value: { ...rule.value as { from: string; to: string }, from: event.target.value } } as SmartCollectionRule)} /><input type="date" value={rule.value.to} onChange={(event) => onChange({ ...rule, value: { ...rule.value as { from: string; to: string }, to: event.target.value } } as SmartCollectionRule)} /></div>
    return <input type="date" value={typeof rule.value === 'string' ? rule.value : ''} onChange={(event) => onChange({ ...rule, value: event.target.value } as SmartCollectionRule)} />
  }
  if (['width', 'height', 'size','colorBrightness','colorSaturation'].includes(rule.field)) {
    if (rule.operator === 'between' && typeof rule.value === 'object' && rule.value && 'min' in rule.value) return <div className="range-input"><input type="number" min="0" value={rule.value.min} onChange={(event) => onChange({ ...rule, value: { ...rule.value as { min: number; max: number }, min: Number(event.target.value) } } as SmartCollectionRule)} /><input type="number" min="0" value={rule.value.max} onChange={(event) => onChange({ ...rule, value: { ...rule.value as { min: number; max: number }, max: Number(event.target.value) } } as SmartCollectionRule)} /></div>
    return <input type="number" min="0" value={typeof rule.value === 'number' ? rule.value : 0} onChange={(event) => onChange({ ...rule, value: Number(event.target.value) } as SmartCollectionRule)} />
  }
  return <input value={String(rule.value ?? '')} onChange={(event) => onChange({ ...rule, value: event.target.value } as SmartCollectionRule)} placeholder={rule.field === 'extension' ? 'png' : '输入文本'} />
}

function defaultRule(id: string, field: SmartCollectionField, folders: Folder[], tags: Tag[]): SmartCollectionRule {
  if (['width', 'height', 'size','colorBrightness','colorSaturation'].includes(field)) return { id, field: field as 'width', operator: 'gte', value: field === 'size' ? 1_000_000 : field.startsWith('color') ? 0.5 : 1000 }
  if (field === 'favorite') return { id, field, operator: 'is', value: true }
  if (field === 'orientation') return { id, field, operator: 'is', value: 'portrait' }
  if (field === 'colorTemperature') return { id, field, operator: 'is', value: 'warm' }
  if (field === 'colorHex') return { id, field, operator: 'near', value: '#6F8F72' }
  if (field === 'folder') return { id, field, operator: 'is', value: folders[0]?.id ?? '' }
  if (field === 'tag') return { id, field, operator: 'is', value: tags[0]?.id ?? '' }
  if (['importedAt', 'createdAt', 'lastOpenedAt'].includes(field)) return { id, field: field as 'importedAt', operator: 'last30', value: null }
  return { id, field: field as 'filename', operator: 'contains', value: field === 'extension' ? 'png' : '' }
}

function withOperator(rule: SmartCollectionRule, operator: string): SmartCollectionRule {
  if (['width', 'height', 'size','colorBrightness','colorSaturation'].includes(rule.field)) return { ...rule, operator: operator as 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'between', value: operator === 'between' ? (typeof rule.value === 'object' && rule.value && 'min' in rule.value ? rule.value : { min: 0, max: rule.field.startsWith('color') ? 1 : 3000 }) : (typeof rule.value === 'number' ? rule.value : 1000) } as SmartCollectionRule
  if (['importedAt', 'createdAt', 'lastOpenedAt'].includes(rule.field)) {
    const today = new Date().toISOString().slice(0, 10)
    const value = ['today', 'last7', 'last30', 'last90'].includes(operator) ? null : operator === 'between' ? { from: today, to: today } : today
    return { ...rule, operator, value } as SmartCollectionRule
  }
  return { ...rule, operator } as SmartCollectionRule
}
