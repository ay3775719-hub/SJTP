export const CONTROLLED_VOCABULARY = {
  category: {
    'category.product_photography': '产品摄影', 'category.outdoor_equipment': '户外装备', 'category.architecture': '建筑',
    'category.interior_design': '室内设计', 'category.graphic_design': '平面设计', 'category.ui_design': 'UI 设计',
    'category.brand_design': '品牌设计', 'category.photography': '摄影', 'category.art': '艺术', 'category.fashion': '时尚',
    'category.food': '美食', 'category.nature': '自然', 'category.transportation': '交通工具', 'category.other': '其他'
  },
  scene: {
    'scene.outdoor': '户外', 'scene.indoor': '室内', 'scene.campsite': '露营地', 'scene.lakeside': '湖边', 'scene.mountain': '山地',
    'scene.studio': '工作室', 'scene.street': '街道', 'scene.office': '办公室', 'scene.bedroom': '卧室', 'scene.living_room': '客厅',
    'scene.kitchen': '厨房', 'scene.retail': '零售空间', 'scene.urban': '城市', 'scene.nature': '自然环境'
  },
  style: {
    'style.product_photography': '产品摄影', 'style.commercial_photography': '商业摄影', 'style.lifestyle_photography': '生活方式摄影',
    'style.minimal': '极简', 'style.japandi': 'Japandi', 'style.editorial': 'Editorial', 'style.brutalism': 'Brutalism',
    'style.retro': '复古', 'style.y2k': 'Y2K', 'style.technology': '科技感', 'style.cinematic': '电影感',
    'style.fresh': '清新', 'style.luxury': '奢华', 'style.naturalism': '自然主义'
  },
  mood: {
    'mood.fresh': '清新', 'mood.calm': '宁静', 'mood.energetic': '活力', 'mood.warm': '温暖', 'mood.cool': '冷静',
    'mood.premium': '高级', 'mood.futuristic': '未来感', 'mood.nostalgic': '怀旧', 'mood.natural': '自然', 'mood.romantic': '浪漫'
  },
  lighting: {
    'lighting.natural_light': '自然光', 'lighting.studio': '棚拍光', 'lighting.hard': '硬光', 'lighting.soft': '柔光',
    'lighting.backlight': '逆光', 'lighting.side': '侧光', 'lighting.top': '顶光', 'lighting.golden_hour': '黄金时刻',
    'lighting.overcast_diffused': '阴天漫射光'
  },
  composition: {
    'composition.centered': '中心构图', 'composition.symmetrical': '对称构图', 'composition.rule_of_thirds': '三分法',
    'composition.negative_space': '大面积留白', 'composition.close_up': '近景', 'composition.detail': '特写',
    'composition.top_down': '俯拍', 'composition.low_angle': '仰拍', 'composition.eye_level': '平视',
    'composition.shallow_depth': '浅景深', 'composition.environmental_product': '环境式产品展示'
  },
  usage: {
    'usage.ecommerce': '电商', 'usage.product_advertising': '产品广告', 'usage.brand_design': '品牌设计',
    'usage.photography_reference': '摄影参考', 'usage.architecture_reference': '建筑参考',
    'usage.interior_reference': '室内设计参考', 'usage.moodboard': 'Moodboard', 'usage.social_media': '社交媒体',
    'usage.poster_design': '海报设计', 'usage.packaging_design': '包装设计', 'usage.ui_inspiration': 'UI 灵感'
  }
} as const

export const MINIMAL_SCENE_VOCABULARY = {
  indoor: '室内', outdoor: '户外', white_background: '白底', studio: '工作室', street: '街道',
  office: '办公室', bedroom: '卧室', living_room: '客厅', kitchen: '厨房', store: '商店',
  nature: '自然环境', showroom: '展厅', other: '其他'
} as const

export const MINIMAL_STYLE_VOCABULARY = {
  product_photography: '产品摄影', lifestyle_photography: '生活方式摄影', commercial_photography: '商业摄影',
  ecommerce_design: '电商产品设计', minimalist: '极简', editorial: 'Editorial', retro: '复古',
  technology: '科技感', cinematic: '电影感', japandi: 'Japandi', brutalism: 'Brutalism',
  luxury: '奢华', natural: '自然主义', fresh: '清新', other: '其他'
} as const

const PRIMARY_OBJECT_ALIASES: Record<string, { key: string; label: string }> = {
  backpack: { key: 'backpack', label: '背包' }, shoes: { key: 'shoes', label: '鞋' }, phone: { key: 'phone', label: '手机' },
  watch: { key: 'watch', label: '手表' }, sofa: { key: 'sofa', label: '沙发' }, chair: { key: 'chair', label: '椅子' },
  car: { key: 'car', label: '汽车' }, architecture: { key: 'architecture', label: '建筑' }, poster: { key: 'poster', label: '海报' },
  packaging: { key: 'packaging', label: '包装' }, person: { key: 'person', label: '人物' }, furniture: { key: 'furniture', label: '家具' }, camera: { key: 'camera', label: '相机' },
  背包: { key: 'backpack', label: '背包' }, 双肩包: { key: 'backpack', label: '背包' }, 户外背包: { key: 'backpack', label: '背包' },
  登山包: { key: 'backpack', label: '背包' }, 轻量背包: { key: 'backpack', label: '背包' }, 鞋: { key: 'shoes', label: '鞋' },
  鞋子: { key: 'shoes', label: '鞋' }, 手机: { key: 'phone', label: '手机' }, 手表: { key: 'watch', label: '手表' },
  沙发: { key: 'sofa', label: '沙发' }, 椅子: { key: 'chair', label: '椅子' }, 汽车: { key: 'car', label: '汽车' },
  建筑: { key: 'architecture', label: '建筑' }, 海报: { key: 'poster', label: '海报' }, 包装: { key: 'packaging', label: '包装' },
  人物: { key: 'person', label: '人物' }, 女性模特: { key: 'person', label: '人物' }, 模特: { key: 'person', label: '人物' },
  家具: { key: 'furniture', label: '家具' }, 相机: { key: 'camera', label: '相机' }
}

export function normalizePrimaryObject(value: string): { value: string; normalizedValue: string } {
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  const alias = PRIMARY_OBJECT_ALIASES[cleaned]
  if (alias) return { value: alias.label, normalizedValue: alias.key }
  if (cleaned.includes('背包') || cleaned.includes('双肩包') || cleaned.includes('登山包')) return { value: '背包', normalizedValue: 'backpack' }
  if (cleaned.includes('人物') || cleaned.includes('模特') || cleaned === '女性' || cleaned === '男性') return { value: '人物', normalizedValue: 'person' }
  return { value: cleaned, normalizedValue: normalizeOpenTerm(cleaned) }
}

export type ControlledVocabularyGroup = keyof typeof CONTROLLED_VOCABULARY

export function controlledLabel(group: ControlledVocabularyGroup, key: string): string {
  const values = CONTROLLED_VOCABULARY[group] as Record<string, string>
  return values[key] ?? key
}

export function normalizeOpenTerm(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}
