// One hue per digit; clusters are coloured by their majority digit so
// disagreement between the cluster strip and the label strip stands out.
export const DIGIT_COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#7f7f7f',
]

// One hue per force, shared by its slider and its curves on the schedule graph; kept apart
// from the digit hues above.
export const FORCE_COLORS = { nb: '#0d9488', mn: '#7c3aed', fp: '#ea580c' } as const

export const FORCE_LABELS = { nb: 'Neighbours', mn: 'Mid-near', fp: 'Far' } as const
