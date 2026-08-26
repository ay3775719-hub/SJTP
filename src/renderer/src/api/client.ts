if (!window.muse) {
  throw new Error('Muse Desktop API unavailable. Start Muse with `npm run dev` or from the installed application.')
}

export const museApi = window.muse
