# v1.2 — MNIST, from pixels to projections, in black and white

Like v1.1, but every digit is binarised after pooling, at each resolution: pixels brighter
than `--threshold` (default `24` of 255) count as stroke and go white, the rest black.
Pooling thins strokes at low resolutions, so a low cut keeps the coarse digits legible; 24
sits at or near the best 5-NN digit accuracy on the binarised pixels from 16×16 down to 2×2.
Leiden clusters and projections are computed from those two levels only. A checkbox
re-colours them as agree / disagree.

From v1.1: like v1.0, but at several digit resolutions. Each digit is zero-padded from 28×28 to
32×32, then average-pooled to 16×16, 8×8, 4×4 and 2×2; UMAP / PaCMAP / LocalMAP are
recomputed at every resolution and the app morphs between them. Leiden clusters (and
so the colours and sort orders) stay fixed at 32×32.

Subsample MNIST, flatten each digit into a row of pixels, cluster the rows with a
scanpy-style pipeline (PCA → kNN graph → Leiden), and explore them in a Vite + React
app: the original vs. sorted pixel matrix (by Leiden cluster or label), linked UMAP /
PaCMAP / LocalMAP projections in 2D and 3D, per-cluster samples and composition.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v1-2/web/public/data/)
cd ../pipeline
uv run v1-2.py                          # defaults: -n 10000 --resolution 0.5
uv run v1-2.py -n 3000 --resolution 1.0 # smaller, faster run
uv run v1-2.py --threshold 64           # only brighter pixels count as stroke

# 2. View
cd ../v1-2/web
pnpm install
pnpm dev
```

- `matrix_original_r<r>.png` / `matrix_sorted_<group>_<within>_r<r>.png`: N × r² grayscale, one digit per row, for r in 32, 16, 8, 4, 2.
- Groups (`leiden` | `label`): Leiden clusters in `sc.tl.dendrogram` order, or digits 0–9.
- Within each group (`random` | `pc1`): original random subsample order, or along the
  group's own first principal component.
- Note: Intel macOS needs `llvmlite<0.45` / `numba<0.62` (pinned in `pyproject.toml`).
