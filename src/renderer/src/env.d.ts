/// <reference types="vite/client" />

import type { MuseAPI } from '@shared/types/ipc'

declare global {
  interface Window {
    muse: MuseAPI
  }
}

export {}
