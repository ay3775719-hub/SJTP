export class MuseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'MuseError'
  }
}

export function toPublicError(error: unknown): Error {
  if (error instanceof MuseError) return new Error(`${error.code}: ${error.message}`)
  return new Error('INTERNAL_ERROR: Muse 遇到了一个内部错误')
}
