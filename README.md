# Dimensional reduction exploration

MNIST, from pixels to projections: flatten digits into rows of pixels, cluster them
scanpy-style (PCA → kNN graph → Leiden), and explore the pixel matrices alongside
UMAP / PaCMAP / LocalMAP projections. Each version builds on the last:

- [v1](v1/) — full 28×28 greyscale digits
- [v2](v2/) — the same, across resolutions from 32×32 down to 2×2
- [v3](v3/) — v2 with every pooled digit binarised to stroke or background

Data for each comes from `pipeline/<version>.py`; each app lives in `<version>/web`.
GitHub Pages serves a landing page (`site/index.html`) with every version beneath it
at `/v1/`, `/v2/` and `/v3/`.
