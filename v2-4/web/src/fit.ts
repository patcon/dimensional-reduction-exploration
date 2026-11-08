/**
 * Where the plot is fitted to: a centre, and how far out from the bulk of the layout to show. A leaning map keeps
 * moving, and its bounding box with it, so fitting to that (as v2.3 did) moves the whole view whenever one outlier
 * does. Instead the view centres on the layout's centroid (or a followed point) and reaches out as far as most
 * points, not the farthest, and eases there rather than jumping.
 */

/** The share of points the fit reaches out to: the rest, the farthest, may leave the plot. */
const FIT_QUANTILE = 0.98
/** At most this many points are measured for the quantile, spread evenly over the layout. */
const SAMPLE = 4096
/** How long the view takes to close most (63%) of the gap to where it should be, in seconds. */
const EASE_SECONDS = 0.6

export interface Fit {
  /** The point at the plot's middle, in layout units. */
  centre: number[]
  /** How far out the plot reaches from the layout's centroid: per axis in 2D (x, y), one radius in 3D. */
  reach: number[]
}

/** The q-th quantile of `values` (sorted in place). */
function quantile(values: Float64Array, q: number) {
  values.sort()
  return values[Math.min(values.length - 1, Math.floor(q * values.length))] || 1
}

/**
 * Where the layout should be fitted to now: centred on its centroid, or on point `follow`, reaching as far from
 * the centroid as FIT_QUANTILE of its points (so following a point pans the view without zooming it).
 */
export function fitOf(Y: Float32Array, dim: number, follow: number | null = null): Fit {
  const n = Y.length / dim
  const mean = Array<number>(dim).fill(0)
  for (let i = 0; i < n; i++) for (let d = 0; d < dim; d++) mean[d] += Y[i * dim + d]
  for (let d = 0; d < dim; d++) mean[d] /= n || 1
  const stride = Math.max(1, Math.floor(n / SAMPLE))
  const m = Math.ceil(n / stride)
  let reach: number[]
  if (dim === 2) {
    const dx = new Float64Array(m)
    const dy = new Float64Array(m)
    for (let s = 0, i = 0; s < m; s++, i += stride) {
      dx[s] = Math.abs(Y[2 * i] - mean[0])
      dy[s] = Math.abs(Y[2 * i + 1] - mean[1])
    }
    reach = [quantile(dx, FIT_QUANTILE), quantile(dy, FIT_QUANTILE)]
  } else {
    const r = new Float64Array(m)
    for (let s = 0, i = 0; s < m; s++, i += stride) {
      let r2 = 0
      for (let d = 0; d < dim; d++) r2 += (Y[i * dim + d] - mean[d]) ** 2
      r[s] = Math.sqrt(r2)
    }
    reach = [quantile(r, FIT_QUANTILE)]
  }
  const centre = follow !== null && follow < n ? Array.from(Y.subarray(follow * dim, follow * dim + dim)) : mean
  return { centre, reach }
}

/** `from` moved toward `to` over `seconds`, as an exponential ease; null `from` (nothing fitted yet) snaps. */
export function easeFit(from: Fit | null, to: Fit, seconds: number): Fit {
  if (!from || from.centre.length !== to.centre.length || from.reach.length !== to.reach.length) return to
  const a = 1 - Math.exp(-Math.max(0, seconds) / EASE_SECONDS)
  const toward = (x: number[], y: number[]) => x.map((v, k) => v + (y[k] - v) * a)
  return { centre: toward(from.centre, to.centre), reach: toward(from.reach, to.reach) }
}

/** Whether `a` is as good as at `b`: within a small share of the reach, so easing can stop. */
export function settled(a: Fit, b: Fit) {
  const tol = 1e-3 * Math.max(...b.reach)
  return a.centre.every((v, k) => Math.abs(v - b.centre[k]) < tol) && a.reach.every((v, k) => Math.abs(v - b.reach[k]) < tol)
}
