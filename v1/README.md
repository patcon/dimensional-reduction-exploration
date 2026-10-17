# v1 — MNIST × Leiden

Subsample MNIST, cluster it with a scanpy-style pipeline (PCA → kNN graph → Leiden),
and render the original vs. cluster-sorted pixel matrix in a Vite + React app.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes web/public/data/)
cd pipeline
uv run process.py                      # defaults: -n 3000 --resolution 0.5
uv run process.py -n 5000 --resolution 1.0

# 2. View
cd ../web
pnpm install
pnpm dev
```

- `matrix_original.png` / `matrix_sorted_{leiden,label}.png`: N × 784 grayscale, one digit per row.
- Leiden sort: clusters follow `sc.tl.dendrogram` order; rows inside a cluster are
  ordered along that cluster's first principal component.
- Label sort: digits 0–9, then Leiden cluster within each digit, then PC1.
- Note: Intel macOS needs `llvmlite<0.45` / `numba<0.62` (pinned in `pyproject.toml`).
