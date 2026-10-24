# v3.2 — Valence particles from MNIST (mobile)

A fresh copy of [v3.1](../v3-1/) to build on.

A valence visualisation fed with stand-in data. Each MNIST digit is one participant: its
pixels, read in order and smoothed, are its valence over time (paper −1, ink +1). The
visualiser is ported from the
[reaction canvas](https://github.com/patcon/polislike-partykit-reaction-canvas)'s valence
cross-section (`plugins/valenceCrossSection`): one chord per participant, in parallel, linear,
diametric or radial geometry, seen as a 2d time slice, a 2d time series or in 3d. A particle
geometry, from the prototype it came from (`docs/pages/valence-onboarding-v3.html`), lets
participants move freely instead.

Digits are 28×28 greyscale, as in v1.0. Clustering follows v1.0 too (PCA → kNN graph →
Leiden), but runs in the browser on whichever digits are picked.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v3-2/web/public/data/)
cd ../pipeline
uv run v3-2.py               # defaults: -n 5000 --n-pcs 50 --seed 0 (about 30 s)

# 2. View
cd ../v3-2/web
pnpm install
pnpm dev
pnpm run check:leiden        # the browser's kNN graph and Leiden against scanpy's
```

## Controls

- **Digits**: filter by label, set the sample size (2–200), reshuffle.
- **Color by**: label (the digit), or Leiden clusters (resolution, neighbours), numbered 1, 2, …
- **Cluster over** (Leiden): the full digit (its principal components), or the trail's window
  of each trace, re-clustered while the playhead moves (1 run per second by default, 0.25–10).
  Clusters keep their number and colour from one run to the next.
- **Chord order**: random, or grouped (group by group, then by first principal component).
- **Reading**: pixel order (rows, snake, columns, spiral, Hilbert); skip pixels blank in every
  sampled digit; smoothing (Gaussian blur, or a lagging moving average); paper −1 or 0.
- **View, geometry, colour by**: as in the reaction canvas's visualiser. Cursor, chord, trail and
  fill can each be coloured by valence or group.
- **Particles** (particle geometry): each digit is a particle. Digits in the same group (label or
  Leiden cluster) pull together and other groups push away, and the centre pulls each digit in by
  its valence now: ink attracts, paper repels, or the other way round with "ink repels from
  centre". Spread draws the whole cloud in (more crowding, so more interaction) or lets it out.
  The forces, their reach and damping can be set; "scatter" starts the particles over.
- **Playback**: 1 pixel per second by default (0.25–60). Trails cover the last 30 seconds
  (5–300) and fade out with age. The matrix below shows one row per digit and one column per
  pixel, with the playhead; click a row to follow that digit.

## How it works

- `pipeline/v3-2.py` writes a pool of 5,000 digits to `web/public/data/`: `matrix.png`
  (N × 784), `pcs.bin` (float32, 50 principal components) and `meta.json` (labels). For a few
  sample picks it also writes scanpy's kNN connectivities and Leiden clusters to
  `pipeline/data/v3-2/leiden_reference.json`, which only the check uses.
- `src/knn.ts` builds the graph `sc.pp.neighbors` does (exact kNN, UMAP connectivities).
  `src/leiden.ts` is Leiden on modularity, 2 iterations, as `sc.tl.leiden(flavor="igraph")`.
  `pnpm run check:leiden` finds the same edges as scanpy (weights within 4e-6), and modularity
  within 0.005 of igraph's or better, averaged over 5 seeds.
- Clustering over the window compares each trace's valence at 32 moments across the trail. Each
  run starts Leiden from the last run's clusters, then gives every new cluster the number of the
  old one it shares most digits with (one to one, biggest overlaps first); the rest take the
  lowest numbers not in use.
- The particle physics is the prototype's (pairwise forces within a reach, a hard core up close,
  a boundary past the ring), with its group-by-group force matrix replaced by one force within
  groups and one between them, as the number of Leiden clusters varies. It steps every frame while
  playing, and holds still while paused. Particle trails can't be read off the trace, so they're
  recorded as particles move, on the same grid of moments as chord trails, and start over on a
  scrub backwards.
- `src/signal.ts` turns each digit into a trace. `src/components/ChordViz.tsx` is the
  cross-section's three.js code, adapted to read traces; its geometries and morphs are unchanged.
  It renders as the original prototype did on three r128 (no colour management, 2px chords),
  rather than the paler output newer three gives by default. Trails are
  drawn from the trace rather than from past frames, so they follow scrubbing.
