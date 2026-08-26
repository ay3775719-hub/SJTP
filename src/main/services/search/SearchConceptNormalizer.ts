const CONCEPTS: Array<[RegExp, string]> = [
  [/(女人|女性|女士|女孩)/g, 'woman'], [/(男人|男性|男士|男孩)/g, 'man'], [/(儿童|孩子|小孩)/g, 'child'], [/(人物|人像|人(?!工)|肖像)/g, 'person'],
  [/(双肩包|登山包|背包)/g, 'backpack'], [/(手提包|挎包|包袋)/g, 'bag'], [/(鞋子|鞋)/g, 'shoe'], [/(椅子|座椅)/g, 'chair'], [/(沙发)/g, 'sofa'], [/(汽车|轿车)/g, 'car'], [/(摩托车|机车)/g, 'motorcycle'], [/(手机)/g, 'phone'], [/(手表|腕表)/g, 'watch'],
  [/(户外|室外)/g, 'outdoor'], [/(室内)/g, 'indoor'], [/(工作室|影棚)/g, 'studio'], [/(白底|白色背景)/g, 'white background'],
  [/(产品摄影|商品摄影|产品图)/g, 'product photo'], [/(人像摄影)/g, 'portrait'], [/(时尚|穿搭)/g, 'fashion'], [/(生活方式摄影)/g, 'lifestyle photo'], [/(裙子|连衣裙|短裙|包臀裙)/g, 'dress']
]

export function normalizeSearchConcept(value: string): string {
  let result = value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
  for (const [pattern, replacement] of CONCEPTS) result = result.replace(pattern, ` ${replacement} `)
  return result.replace(/[，。！？、,!?]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function promptForSearchConcept(value: string): string {
  const normalized = normalizeSearchConcept(value)
  return `a photo of ${normalized || value}`
}
