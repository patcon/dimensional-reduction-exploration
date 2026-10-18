# v1.0 — MNIST, from pixels to projections

Subsample MNIST, flatten each digit into a 784-pixel row, cluster the rows with a
scanpy-style pipeline (PCA → kNN graph → Leiden), and explore them in a Vite + React
app: the original vs. sorted pixel matrix (by Leiden cluster or label), linked UMAP /
PaCMAP / LocalMAP projections in 2D and 3D, per-cluster samples and composition.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v1-0/web/public/data/)
cd ../pipeline
uv run v1-0.py               # defaults: -n 3000 --resolution 0.5
uv run v1-0.py -n 5000 --resolution 1.0

# 2. View
cd ../v1-0/web
pnpm install
pnpm dev
```

- `matrix_original.png` / `matrix_sorted_<group>_<within>.png`: N × 784 grayscale, one digit per row.
- Groups (`leiden` | `label`): Leiden clusters in `sc.tl.dendrogram` order, or digits 0–9.
- Within each group (`random` | `pc1`): original random subsample order, or along the
  group's own first principal component.
- Note: Intel macOS needs `llvmlite<0.45` / `numba<0.62` (pinned in `pyproject.toml`).
