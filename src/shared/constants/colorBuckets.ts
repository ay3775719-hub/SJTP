export const COLOR_BUCKETS = {
  red: { label: '红色', hex: '#D94343' },
  orange: { label: '橙色', hex: '#E47D2E' },
  yellow: { label: '黄色', hex: '#DAB83E' },
  green: { label: '绿色', hex: '#58A66C' },
  cyan: { label: '青色', hex: '#50AEB1' },
  blue: { label: '蓝色', hex: '#5579BD' },
  purple: { label: '紫色', hex: '#8858AA' },
  pink: { label: '粉色', hex: '#D979A0' },
  brown: { label: '棕色', hex: '#795548' },
  black: { label: '黑色', hex: '#191919' },
  white: { label: '白色', hex: '#F2F2F0' },
  gray: { label: '灰色', hex: '#808080' },
  'warm-neutral': { label: '暖中性色', hex: '#B9A58C' },
  'cool-neutral': { label: '冷中性色', hex: '#8B9AA4' }
} as const

export type ColorBucket = keyof typeof COLOR_BUCKETS
