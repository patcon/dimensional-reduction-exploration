/** Sizes shared by the flat digit preview and the isometric stack, so one can stand in for the other. */

/** Side of the flat preview's digit, unless it's filling the stack's footprint. */
export const PREVIEW_SIZE = 112

export const TILE = 84 // side of each stack layer before the isometric squash
export const GAP = 20 // vertical distance between stacked layers
export const PAD = 6
const LABEL_WIDTH = 44 // room for each layer's resolution label
export const COS30 = Math.cos(Math.PI / 6)
export const DIAMOND_WIDTH = 2 * TILE * COS30

/** The stack's footprint, so the flat preview can take the same space and nothing shifts between them. */
export const stackSize = (nLayers: number) => ({
  width: Math.ceil(DIAMOND_WIDTH + LABEL_WIDTH + PAD * 2),
  height: Math.ceil(TILE + (nLayers - 1) * GAP + PAD * 2),
})

/** Side of the flat digit when it fills the stack's footprint: its full height, inside a 1px border. */
export const flatSize = (nLayers: number) => stackSize(nLayers).height - 2
