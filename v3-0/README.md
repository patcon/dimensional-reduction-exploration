# v3.0 — A crowd of digits

Each MNIST digit becomes a participant, and its 784 pixels become one reaction to a content
stream. The pixels are read out one by one as valence: ink agrees, paper disagrees. Playing
every digit's trace together, slowed down and smoothed, drives the valence visualiser from the
[reaction canvas](https://github.com/patcon/polislike-partykit-reaction-canvas): its
cross-section of chords (`plugins/valenceCrossSection`, the React port of
`valence-onboarding-v3.html`). Each digit gets one chord, rooted at the centre and pushed out by
its valence, laid out in one of five geometries and seen in three views.

This remixes v1.0. It uses full greyscale digits at 28×28 only (no other resolutions), shows the
same pixel matrix, and clusters the same way (PCA → kNN graph → Leiden). The matrix is now a
score that plays from left to right. The clustering is redone in the browser for whichever
digits you pick, and it can group the chords.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v3-0/web/public/data/)
cd ../pipeline
uv run v3-0.py               # defaults: -n 5000 --n-pcs 50 --seed 0 (about 30 s)

# 2. View
cd ../v3-0/web
pnpm install
pnpm dev
pnpm run check:leiden        # the browser's kNN graph and Leiden against scanpy's
```

## Playing it

- **Digits.** Toggle digits 0–9 to filter the pool. **sample** sets how many take part
  (2–200), and **Reshuffle** draws another sample of the same digits.
- **Groups.** Group **by digit**, or by **Leiden** cluster. Leiden runs on a kNN graph of just
  the sampled digits, so you can adjust **resolution** and **neighbours** live. Clusters are
  named after their majority digit (3a, 3b, …) and coloured in that digit's hue, with lightness
  telling apart clusters of the same digit. The readout shows how many clusters there are and
  their modularity.
- **Chord order.** **random** places chords in the order the digits were drawn; **grouped**
  places them group by group, and within each group along the first principal component, so
  neighbouring chords are similar digits. Switching between them makes each chord glide to
  its new place.
- **Reading.** This is the order a digit's pixels are read in: **rows**; **snake** (rows that
  alternate direction, so each pixel touches the last); **columns**; **spiral** (from the
  edge inwards); or **Hilbert** (a space-filling curve, so moments close in time are close on
  the page too). **skip blank pixels** leaves out pixels that are blank in every sampled digit,
  which is the dead air around the edges. **smoothing** takes either a centred **blur** or a
  **lag**, an exponential moving average, so that a reaction trails the ink that caused it.
  **paper −1, ink +1** spans the full valence range; **paper 0, ink +1** makes the paper
  neutral, so that only ink shows.
- **View and geometry** (over the visualiser). The views are **2d time slice** (now),
  **2d time series** (side on, with time running left to right) and **3d** (drag to orbit,
  scroll to zoom). The chord geometries are **parallel**, **linear**, **diametric** and
  **radial**, and they morph into one another, as in the reaction canvas. **cursors** is new: it
  draws the reaction canvas itself, with its agree, disagree and pass corners. On that canvas
  every point on one line has the same valence, and each digit is a cursor on the line for its
  valence. With **grouped** order, each group sits at its own place along those lines.
- **Colour by.** Cursor, chord, trace (the trail) and fill (the ribbon under the trail) are each
  coloured by **valence** or by **group**, each with its own opacity.
- **The score.** This is v1's matrix, played: one row per digit in chord order and one column
  per pixel read, showing the smoothed signal. The playhead sweeps across, with the trail's
  reach shaded. Set the speed from 1 to 120 pixels a second (8 by default, so a digit takes about
  a minute). **trail** sets how far back trails reach, **loop** sets whether playback wraps,
  and the scrubber seeks. Click a row to follow that digit. It gets a ring in the visualiser,
  and the panel beside the visualiser shows it being read: pixels already read show in full,
  the trail is tinted, and the pixel being read is marked, with its valence now. Each group's
  mean valence is shown as a bar.

## How it works

- `pipeline/v3-0.py` draws a pool of 5,000 digits and writes it to `web/public/data/`:
  `matrix.png` (N × 784 greyscale), `pcs.bin` (float32, the pool's first 50 principal
  components) and `meta.json` (labels). For a few sample picks, it also writes scanpy's kNN
  connectivities, its Leiden clusters (igraph flavour) and their modularity to
  `pipeline/data/v3-0/leiden_reference.json`. That file stays out of the site; only the check
  uses it.
- `src/knn.ts` builds the graph that `sc.pp.neighbors` builds: exact k nearest neighbours with the
  point itself counted first, then UMAP's fuzzy simplicial set as edge weights. `src/leiden.ts`
  is Leiden on modularity with a resolution, run for 2 iterations as `sc.tl.leiden` does:
  it moves nodes, refines each cluster into well-connected pieces, and collapses those pieces,
  repeating until nothing more merges. `pnpm run check:leiden` checks both against scanpy.
  The graphs match edge for edge, with weights within 4e-6. Across 5 seeds, the browser's
  Leiden finds clusters with modularity at least igraph's, less 0.005. Both are randomised
  heuristics, so the clusters themselves agree closely but not exactly (adjusted Rand index
  0.6–1).
- `src/signal.ts` turns each digit into a trace: reading order, skipping blank pixels,
  smoothing, then valence. `src/components/ChordViz.tsx` is the cross-section, ported with
  three.js. Its chord geometry and morphs are unchanged. One thing is new: the whole trace is
  known in advance, so trails are drawn from the trace itself rather than from a buffer of past
  frames. That means trails follow a scrub backwards, and they are drawn in the current
  geometry.
