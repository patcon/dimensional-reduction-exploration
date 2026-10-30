# v5.0 — MNIST walk music

A port of "Density clusters on deskewed digits" (a single HTML page), with the UI of the earlier
versions: the map fills the window, with playback on a drawer along the bottom and settings in its
tabs, as in v2.1, v3.2 and on. Only the page's music is brought over; its digits aren't deskewed.

2,000 MNIST digits, 200 of each, lie on a PaCMAP map. A walker steps at random through their
nearest neighbours (k = 10), each step to a neighbour as likely as it's strongly linked, and plays
what it steps on. It's ringed in white on the map, its trail behind it and its small group ringed.

- **Broad groups set the harmony**, one chord tone each: a single tone for one, an open fifth for
  two, a triad for three, up to a dense cluster at twelve, its timbre fuller and its voices spread
  wider the more there are. A change in how many is announced with an arpeggio. The walker's
  group's tone is louder, and the bass plays it; on noise, the bass drops out and the melody
  softens. They're found by HDBSCAN on a 10-D UMAP of the digits (by density, deciding how many
  there are itself and leaving stragglers as noise; min group size, min samples, allow one group),
  or by Leiden on the neighbours (as many as digits chosen, a number wanted, or a resolution set by
  hand). With Leiden, "Count up from 1 group" adds a group every 8 seconds.
- **Small groups set the melody**: Leiden at a high resolution on the same neighbours, each given a
  note of the chord. Steps per second, and swing.
- **Mix**: the chord, bass and melody's levels.
- **Music tab**: what the walker is on, the harmony strip (a bar per chord tone, swelling as the pad
  does, a dot on each melody note) and the chord's qualities. **Groups tab**: how many broad groups,
  how much is noise, how well they match the true digits (ARI), and what each contains.
- **Over the map**: the digits on it, by label, along the top, and the walker's digit in the
  corner. Tap the map to move the walker; the dice and shuffle buttons jump it anywhere, or to
  another broad group. Hold the layers button to see the small groups instead.
- With no digits, or every one left as noise, the walk keeps time with a click instead.

UMAP and PaCMAP are worked out once, in the pipeline, on every digit; choosing digits keeps theirs.
The neighbours, HDBSCAN and Leiden run in the browser, in a worker. The synth, Leiden, HDBSCAN and
kNN graph are v4.1's.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v5-0/web/public/data/)
cd ../pipeline
uv run v5-0.py               # defaults: --per-digit 200 --n-pcs 50 --seed 0

# 2. View
cd ../v5-0/web
pnpm install
pnpm dev
```
