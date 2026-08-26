import { perceptualHashDistance } from './PerceptualHashService'

export const NEAR_DUPLICATE_THRESHOLD = 0.9
export const NEAR_DUPLICATE_TOP_K = 20

export interface NearDuplicateSignals {
  visualSimilarity: number
  aspectRatioScore: number
  dimensionScore: number
  perceptualHashDistance: number
}

export interface NearDuplicateScore extends NearDuplicateSignals { score: number; qualifies: boolean }

export function scoreNearDuplicate(input: NearDuplicateSignals): NearDuplicateScore {
  const pHashScore = Math.max(0, 1 - input.perceptualHashDistance / 24)
  const score = 0.58 * input.visualSimilarity + 0.27 * pHashScore + 0.1 * input.aspectRatioScore + 0.05 * input.dimensionScore
  const strongPerceptualEvidence = input.perceptualHashDistance <= 10 && input.visualSimilarity >= 0.88
  const strongVisualEvidence = input.perceptualHashDistance <= 16 && input.visualSimilarity >= 0.94
  return { ...input, score, qualifies: score >= NEAR_DUPLICATE_THRESHOLD && input.aspectRatioScore >= 0.88 && (strongPerceptualEvidence || strongVisualEvidence) }
}

export function aspectRatioScore(left: { width: number; height: number }, right: { width: number; height: number }): number {
  const leftRatio = left.width / Math.max(1, left.height), rightRatio = right.width / Math.max(1, right.height)
  return Math.min(leftRatio, rightRatio) / Math.max(leftRatio, rightRatio)
}

export function dimensionScore(left: { width: number; height: number }, right: { width: number; height: number }): number {
  const leftPixels = left.width * left.height, rightPixels = right.width * right.height
  return Math.sqrt(Math.min(leftPixels, rightPixels) / Math.max(1, Math.max(leftPixels, rightPixels)))
}

export function scorePair(
  left: { width: number; height: number; pHash: string },
  right: { width: number; height: number; pHash: string },
  visualSimilarity: number
): NearDuplicateScore {
  return scoreNearDuplicate({ visualSimilarity, aspectRatioScore: aspectRatioScore(left, right), dimensionScore: dimensionScore(left, right), perceptualHashDistance: perceptualHashDistance(left.pHash, right.pHash) })
}
