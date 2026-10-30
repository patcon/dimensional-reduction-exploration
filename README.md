# Dimensional reduction exploration

MNIST, from pixels to projections: flatten digits into rows of pixels, cluster them
scanpy-style (PCA → kNN graph → Leiden), and explore the pixel matrices alongside
UMAP / PaCMAP / LocalMAP projections. Each version builds on the last:

- [v1.0](v1-0/) — full 28×28 greyscale digits
- [v1.1](v1-1/) — the same, across resolutions from 32×32 down to 2×2
- [v1.2](v1-2/) — v1.1 with every pooled digit binarised to stroke or background
- [v2.0](v2-0/) — PaCMAP's optimisation running live in the browser, in 2D or 3D, its
  three forces played from sliders or MIDI
- [v2.1](v2-1/) — Playable PaCMAP (mobile): building a mobile version of v2.0
- [v3.0](v3-0/) — a valence visualisation fed with stand-in data: each digit's pixels, read in
  order, as one participant's valence over time
- [v3.1](v3-1/) — valence particles: a fresh copy of v3.0 to build on
- [v3.2](v3-2/) — valence particles (mobile): building a mobile version of v3.1
- [v3.3](v3-3/) — valence particles (speaker): comparing the MNIST digits against a ground truth
  of one digit broadcasting itself, the others heard by how far they agree
- [v3.4](v3-4/) — valence particles (drawn paths): a fresh copy of v3.3, to read digits along
  their drawn paths
- [v4.0](v4-0/) — MNIST valence participation: v3.3 with live participants, who draw a digit by
  tilting their phones and watch their cursor join the digits like it (a Cloudflare Worker, so not on
  GitHub Pages)
- [v4.1](v4-1/) — MNIST valence music: v4.0 with music, a random walk through the digits' nearest
  neighbours over the window, its harmony set by their broad clusters and its melody by their small ones
  (a Cloudflare Worker too)

Data for each comes from `pipeline/v<n>.py` (e.g. `pipeline/v2-0.py`); each app lives in
`v<n>/web`. GitHub Pages serves a landing page (`site/index.html`) with every version
beneath it at `/v1-0/`, `/v1-1/`, `/v1-2/`, `/v2-0/`, `/v2-1/`, `/v3-0/`, `/v3-1/`, `/v3-2/`, `/v3-3/` and `/v3-4/`.
