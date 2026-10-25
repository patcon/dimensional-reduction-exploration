// Check the browser's clustering against scanpy's on the same digits, using the reference
// written by pipeline/v3-3.py (to pipeline/data/v3-3/, kept out of the site): for a few picks
// of digits, scanpy's kNN connectivities on their principal components, and its Leiden
// clusters (igraph flavour) and their modularity.
//
// Two checks per pick:
// - Graph: knnGraph() on the same principal components must give scanpy's edges, with the
//   same weights (to float32 rounding).
// - Leiden: on scanpy's own graph, leiden() must find clusters at least as good, by
//   modularity, as igraph's (within MODULARITY_SLACK, averaged over a few seeds). Both are
//   randomised heuristics, so the clusters themselves needn't match exactly; their
//   agreement (adjusted Rand index) is printed for a look.
import { readFileSync } from 'node:fs'
import { graphFromEdges, knnGraph, type Graph } from '../src/knn.ts'
import { leiden, modularity } from '../src/leiden.ts'

const SEEDS = [0, 1, 2, 3, 4]
const WEIGHT_TOLERANCE = 1e-3
const MODULARITY_SLACK = 0.005

interface Case {
  digits: number[]
  resolution: number
  nNeighbors: number
  nIterations: number
  rows: number[]
  edges: { i: number[]; j: number[]; w: number[] }
  membership: number[]
  modularity: number
}

const dataDir = new URL('../public/data/', import.meta.url)
const meta = JSON.parse(readFileSync(new URL('meta.json', dataDir), 'utf8')) as { nPcs: number }
const pcsBuf = readFileSync(new URL('pcs.bin', dataDir))
const pcs = new Float32Array(pcsBuf.buffer.slice(pcsBuf.byteOffset, pcsBuf.byteOffset + pcsBuf.byteLength))
const { cases } = JSON.parse(
  readFileSync(new URL('../../../pipeline/data/v3-3/leiden_reference.json', import.meta.url), 'utf8'),
) as { cases: Case[] }

function edgeMap(g: Graph) {
  const m = new Map<string, number>()
  for (let i = 0; i < g.n; i++)
    for (let e = g.offsets[i]; e < g.offsets[i + 1]; e++) if (i < g.nbrs[e]) m.set(`${i}-${g.nbrs[e]}`, g.weights[e])
  return m
}

/** Adjusted Rand index between two clusterings of the same nodes. */
function ari(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length
  const pairs = (x: number) => (x * (x - 1)) / 2
  const cells = new Map<string, number>()
  const rows = new Map<number, number>()
  const cols = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    cells.set(`${a[i]},${b[i]}`, (cells.get(`${a[i]},${b[i]}`) ?? 0) + 1)
    rows.set(a[i], (rows.get(a[i]) ?? 0) + 1)
    cols.set(b[i], (cols.get(b[i]) ?? 0) + 1)
  }
  let index = 0
  for (const c of cells.values()) index += pairs(c)
  let sumRows = 0
  for (const c of rows.values()) sumRows += pairs(c)
  let sumCols = 0
  for (const c of cols.values()) sumCols += pairs(c)
  const expected = (sumRows * sumCols) / pairs(n)
  const max = (sumRows + sumCols) / 2
  return max === expected ? 1 : (index - expected) / (max - expected)
}

let ok = true
for (const c of cases) {
  const n = c.rows.length
  const name = `digits ${c.digits.join('')}, n=${n}, resolution ${c.resolution}`
  const points = new Float32Array(n * meta.nPcs)
  c.rows.forEach((row, i) => points.set(pcs.subarray(row * meta.nPcs, (row + 1) * meta.nPcs), i * meta.nPcs))

  const ours = edgeMap(knnGraph(points, n, meta.nPcs, c.nNeighbors))
  const scanpyGraph = graphFromEdges(n, c.edges.i, c.edges.j, c.edges.w)
  const theirs = edgeMap(scanpyGraph)
  let shared = 0
  let maxDiff = 0
  for (const [key, w] of theirs) {
    if (!ours.has(key)) continue
    shared++
    maxDiff = Math.max(maxDiff, Math.abs(ours.get(key)! - w))
  }
  const jaccard = shared / (ours.size + theirs.size - shared)
  const graphOk = jaccard === 1 && maxDiff <= WEIGHT_TOLERANCE

  const runs = SEEDS.map((seed) => leiden(scanpyGraph, { resolution: c.resolution, iterations: c.nIterations, seed }))
  const qs = runs.map((m) => modularity(scanpyGraph, m, c.resolution))
  const meanQ = qs.reduce((a, b) => a + b, 0) / qs.length
  const theirQ = modularity(scanpyGraph, c.membership, c.resolution)
  const leidenOk = meanQ >= c.modularity - MODULARITY_SLACK && Math.abs(theirQ - c.modularity) < 1e-6
  const clusters = runs.map((m) => new Set(m).size)
  const agreement = runs.map((m) => ari(m, c.membership))

  console.log(`${graphOk && leidenOk ? 'ok  ' : 'FAIL'} ${name}`)
  console.log(`     graph: ${ours.size} vs scanpy's ${theirs.size} edges, jaccard ${jaccard.toFixed(4)}, max weight diff ${maxDiff.toExponential(1)}`)
  console.log(
    `     leiden: modularity ${meanQ.toFixed(4)} (seeds ${qs.map((q) => q.toFixed(4)).join(' ')}) vs igraph's ${c.modularity.toFixed(4)}; ` +
      `${clusters.join('/')} clusters vs ${new Set(c.membership).size}; ARI ${agreement.map((a) => a.toFixed(2)).join(' ')}`,
  )
  ok &&= graphOk && leidenOk
}
if (!ok) process.exit(1)
