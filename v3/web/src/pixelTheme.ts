import { createContext, useContext } from 'react'

export type RGB = readonly [number, number, number]

/** How a pixel value (black 0 or white 255 after binarising; mid-grey 128 if ever posterised) is drawn, and what fills an empty digit. */
export interface PixelTheme {
  shade: (v: number) => RGB
  blank: RGB
}

export const GREYSCALE: PixelTheme = { shade: (v) => [v, v, v], blank: [0, 0, 0] }

// Vote colours from valency-anndata's dataset fingerprints, where white marks an unseen statement.
export const VOTE_COLORS = { agree: '#006837', pass: '#fefe12', disagree: '#a50026' }
const hex = (c: string): RGB => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as unknown as RGB
const AGREE = hex(VOTE_COLORS.agree)
const PASS = hex(VOTE_COLORS.pass)
const DISAGREE = hex(VOTE_COLORS.disagree)

/** White pixels read as agree, mid-grey as pass and black as disagree. */
export const VOTES: PixelTheme = {
  shade: (v) => (v < 64 ? DISAGREE : v > 192 ? AGREE : PASS),
  blank: [255, 255, 255],
}

export const PixelThemeContext = createContext(GREYSCALE)
export const usePixelTheme = () => useContext(PixelThemeContext)
