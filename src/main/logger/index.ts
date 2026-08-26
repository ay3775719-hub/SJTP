import log from 'electron-log/main'

log.initialize()
log.transports.file.level = 'info'
// Packaged GUI processes do not own a durable stdout pipe. Writing console
// logs after a launcher exits can raise EPIPE and crash Electron's main
// process, while the file transport remains available for diagnostics.
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : false

export const logger = log.scope('muse')

export function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}
