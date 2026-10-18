# v3 — MNIST, from pixels to projections, in three shades

Like v2, but every digit is posterised to black, mid-grey or white after pooling, at
each resolution. Pixels in the middle 15% of the brightness range become grey
(`--grey-band`, default `0.15`, sets that share); darker ones go black, lighter ones
white. Leiden clusters and projections are computed from those three levels only. A checkbox
re-colours the three shades as agree / pass / disagree.

From v2: like v1, but at several digit resolutions. Each digit is zero-padded from 28×28 to
32×32, then average-pooled to 16×16, 8×8, 4×4 and 2×2; UMAP / PaCMAP / LocalMAP are
recomputed at every resolution and the app morphs between them. Leiden clusters (and
so the colours and sort orders) stay fixed at 32×32.

Subsample MNIST, flatten each digit into a row of pixels, cluster the rows with a
scanpy-style pipeline (PCA → kNN graph → Leiden), and explore them in a Vite + React
app: the original vs. sorted pixel matrix (by Leiden cluster or label), linked UMAP /
PaCMAP / LocalMAP projections in 2D and 3D, per-cluster samples and composition.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v3/web/public/data/)
cd ../pipeline
uv run v3.py                            # defaults: -n 10000 --resolution 0.5
uv run v3.py -n 3000 --resolution 1.0   # smaller, faster run
uv run v3.py --grey-band 0.5            # grey for the middle half of the range

# 2. View
cd ../v3/web
pnpm install
pnpm dev
```

- `matrix_original_r<r>.png` / `matrix_sorted_<group>_<within>_r<r>.png`: N × r² grayscale, one digit per row, for r in 32, 16, 8, 4, 2.
- Groups (`leiden` | `label`): Leiden clusters in `sc.tl.dendrogram` order, or digits 0–9.
- Within each group (`random` | `pc1`): original random subsample order, or along the
  group's own first principal component.
- Note: Intel macOS needs `llvmlite<0.45` / `numba<0.62` (pinned in `pyproject.toml`).
