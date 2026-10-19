# v3.0 — Valence traces from MNIST

A valence visualisation fed with stand-in data. Each MNIST digit is one participant: its
pixels, read in order and smoothed, are its valence over time (paper −1, ink +1). The
visualiser is ported from the
[reaction canvas](https://github.com/patcon/polislike-partykit-reaction-canvas)'s valence
cross-section (`plugins/valenceCrossSection`): one chord per participant, in parallel, linear,
diametric or radial geometry, seen as a 2d time slice, a 2d time series or in 3d.

Digits are 28×28 greyscale, as in v1.0. Clustering follows v1.0 too (PCA → kNN graph →
Leiden), but runs in the browser on whichever digits are picked.

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

## Controls

- **Digits**: filter by label, set the sample size (2–200), reshuffle.
- **Groups**: by digit, or Leiden clusters (resolution, neighbours). Clusters are named and
  coloured after their majority digit (3a, 3b, …).
- **Chord order**: random, or grouped (group by group, then by first principal component).
- **Reading**: pixel order (rows, snake, columns, spiral, Hilbert); skip pixels blank in every
  sampled digit; smoothing (Gaussian blur, or a lagging moving average); paper −1 or 0.
- **View, geometry, colour by**: as in the reaction canvas's visualiser. Cursor, chord, trail and
  fill can each be coloured by valence or group.
- **Playback**: 1 pixel per second by default (0.25–60). Trails cover the last 30 seconds
  (5–300) and fade out with age. The matrix below shows one row per digit and one column per
  pixel, with the playhead; click a row to follow that digit.

## How it works

- `pipeline/v3-0.py` writes a pool of 5,000 digits to `web/public/data/`: `matrix.png`
  (N × 784), `pcs.bin` (float32, 50 principal components) and `meta.json` (labels). For a few
  sample picks it also writes scanpy's kNN connectivities and Leiden clusters to
  `pipeline/data/v3-0/leiden_reference.json`, which only the check uses.
- `src/knn.ts` builds the graph `sc.pp.neighbors` does (exact kNN, UMAP connectivities).
  `src/leiden.ts` is Leiden on modularity, 2 iterations, as `sc.tl.leiden(flavor="igraph")`.
  `pnpm run check:leiden` finds the same edges as scanpy (weights within 4e-6), and modularity
  within 0.005 of igraph's or better, averaged over 5 seeds.
- `src/signal.ts` turns each digit into a trace. `src/components/ChordViz.tsx` is the
  cross-section, ported with three.js; its geometries and morphs are unchanged. Trails are
  drawn from the trace rather than from past frames, so they follow scrubbing.
