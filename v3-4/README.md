# v3.4 — Valence particles from MNIST (drawn paths)

A fresh copy of [v3.3](../v3-3/) to build on. It will read digits along their drawn paths, as a
pen would trace the stroke, rather than in a fixed sweep.

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
# 1. Process data (downloads MNIST sprite on first run; writes v3-4/web/public/data/)
cd ../pipeline
uv run v3-4.py               # defaults: -n 5000 --n-pcs 50 --seed 0 (about 30 s)

# 2. View
cd ../v3-4/web
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
- **Speaker** (the megaphone under the corner digit): makes the followed digit the speaker, which
  every other digit then reacts to. A digit's valence becomes its agreement with the speaker, pixel
  by pixel: where both are paper, or both ink, they agree (+1); ink against paper disagrees (−1).
  The speaker leaves the sample and shrinks behind the corner square, which shows the followed
  digit's agreement in black and white (tap the speaker for the digit itself). Tapping the
  megaphone again releases it back among the digits.
- **Particles** (particle geometry): each digit is a particle. Digits in the same group (label or
  Leiden cluster) pull together and other groups push away. With a speaker, it sits at the
  centre, and the field glides to centre on it: it pulls in the digits agreeing with it now and
  pushes out those disagreeing (or the other way round with "agreement repels from speaker").
  With no speaker, nothing at the centre pulls. Spread draws the whole cloud in (more crowding,
  so more interaction) or lets it out. The forces, their reach and damping can be set; "scatter"
  starts the particles over.
- **Playback**: 1 pixel per second by default (0.25–60). Trails cover the last 30 seconds
  (5–300) and fade out with age. The matrix below shows one row per digit and one column per
  pixel, with the playhead; click a row to follow that digit.

## How it works

- `pipeline/v3-4.py` writes a pool of 5,000 digits to `web/public/data/`: `matrix.png`
  (N × 784), `pcs.bin` (float32, 50 principal components) and `meta.json` (labels). For a few
  sample picks it also writes scanpy's kNN connectivities and Leiden clusters to
  `pipeline/data/v3-4/leiden_reference.json`, which only the check uses.
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
