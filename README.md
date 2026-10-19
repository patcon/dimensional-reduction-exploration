# Dimensional reduction exploration

MNIST, from pixels to projections: flatten digits into rows of pixels, cluster them
scanpy-style (PCA → kNN graph → Leiden), and explore the pixel matrices alongside
UMAP / PaCMAP / LocalMAP projections. Each version builds on the last:

- [v1.0](v1-0/) — full 28×28 greyscale digits
- [v1.1](v1-1/) — the same, across resolutions from 32×32 down to 2×2
- [v1.2](v1-2/) — v1.1 with every pooled digit binarised to stroke or background
- [v2.0](v2-0/) — PaCMAP's optimisation running live in the browser, in 2D or 3D, its
  three forces played from sliders or MIDI
- [v3.0](v3-0/) — a valence visualisation fed with stand-in data: each digit's pixels, read in
  order, as one participant's valence over time

Data for each comes from `pipeline/v<n>.py` (e.g. `pipeline/v2-0.py`); each app lives in
`v<n>/web`. GitHub Pages serves a landing page (`site/index.html`) with every version
beneath it at `/v1-0/`, `/v1-1/`, `/v1-2/`, `/v2-0/` and `/v3-0/`.
