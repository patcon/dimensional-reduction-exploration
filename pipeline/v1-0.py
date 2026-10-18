"""Subsample MNIST, cluster it scanpy-style with Leiden, and export a cluster-sorted matrix.

The source sprite (mnist_images.png) is a 784 x 65000 image: each row is one
28x28 digit flattened. Labels are 65000 one-hot rows of 10 uint8 bytes.

Outputs (written to ../v1-0/web/public/data/):
  matrix_original.png  N x 784 grayscale, subsample in random order
  matrix_sorted_<group>_<within>.png
                       same rows, grouped by Leiden cluster or true label
                       (group = leiden|label), ordered within each group
                       randomly or by the group's own PC1 (within = random|pc1)
  meta.json            per-row cluster/label, projections (UMAP / PaCMAP / LocalMAP, 2D + 3D), per-cluster summaries
"""

import argparse
import json
import urllib.request
from pathlib import Path

import numba

# numba's default OpenMP threading layer segfaults alongside the libomp bundled
# with faiss/sklearn (seen running PaCMAP on macOS x86_64). Must be set before
# any parallel numba code runs.
numba.config.THREADING_LAYER = "workqueue"

import numpy as np  # noqa: E402
import pacmap  # noqa: E402
import scanpy as sc  # noqa: E402
from anndata import AnnData  # noqa: E402
from PIL import Image  # noqa: E402

IMAGES_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_images.png"
LABELS_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_labels_uint8"
N_TOTAL = 65000
N_PIXELS = 784
N_CLASSES = 10

HERE = Path(__file__).parent
RAW_DIR = HERE / "data" / "raw"
OUT_DIR = HERE.parent / "v1-0" / "web" / "public" / "data"


def fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {url}")
        # Download to a temp name so an interrupted run never leaves a partial "cached" file.
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(dest)
    else:
        print(f"Using cached {dest.name}")
    return dest


def load_mnist() -> tuple[np.ndarray, np.ndarray]:
    img_path = fetch(IMAGES_URL, RAW_DIR / "mnist_images.png")
    lbl_path = fetch(LABELS_URL, RAW_DIR / "mnist_labels_uint8")

    # Sprite is stored as RGBA but the digit is in every channel; take red.
    sprite = np.asarray(Image.open(img_path).convert("L"), dtype=np.uint8)
    assert sprite.shape == (N_TOTAL, N_PIXELS), sprite.shape

    onehot = np.fromfile(lbl_path, dtype=np.uint8).reshape(N_TOTAL, N_CLASSES)
    labels = onehot.argmax(axis=1)
    return sprite, labels


def within_cluster_order(X: np.ndarray) -> np.ndarray:
    """Order rows of one cluster along its own first principal component."""
    if len(X) < 3:
        return np.arange(len(X))
    centered = X - X.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    return np.argsort(centered @ vt[0])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-n", "--n-samples", type=int, default=3000)
    parser.add_argument("--n-pcs", type=int, default=50)
    parser.add_argument("--n-neighbors", type=int, default=15)
    parser.add_argument("--resolution", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    sprite, labels = load_mnist()

    rng = np.random.default_rng(args.seed)
    idx = rng.choice(N_TOTAL, size=args.n_samples, replace=False)
    pixels = sprite[idx]

    adata = AnnData(X=pixels.astype(np.float32) / 255.0)
    adata.obs["label"] = labels[idx].astype(str)
    adata.obs["source_index"] = idx

    # Same recipe as a typical scanpy single-cell workflow, minus the
    # count normalisation / log1p steps that don't apply to pixel intensities.
    sc.pp.pca(adata, n_comps=args.n_pcs, random_state=args.seed)
    sc.pp.neighbors(adata, n_neighbors=args.n_neighbors, n_pcs=args.n_pcs, random_state=args.seed)
    sc.tl.leiden(
        adata,
        resolution=args.resolution,
        flavor="igraph",
        n_iterations=2,
        directed=False,
        random_state=args.seed,
    )
    # scanpy always writes X_umap, so stash each embedding under its own key.
    projections = {}
    for dims in (2, 3):
        sc.tl.umap(adata, n_components=dims, random_state=args.seed)
        projections[f"umap{dims}d"] = adata.obsm["X_umap"].copy()
    # PaCMAP and LocalMAP take raw pixels; they apply their own PCA preprocessing.
    for name, cls in (("pacmap", pacmap.PaCMAP), ("localmap", pacmap.LocalMAP)):
        for dims in (2, 3):
            reducer = cls(n_components=dims, random_state=args.seed)
            projections[f"{name}{dims}d"] = reducer.fit_transform(adata.X)
    # Hierarchical ordering of clusters so similar clusters sit next to each other.
    sc.tl.dendrogram(adata, groupby="leiden", n_pcs=args.n_pcs)

    cluster_order = [int(c) for c in adata.uns["dendrogram_leiden"]["categories_ordered"]]
    clusters = adata.obs["leiden"].astype(int).to_numpy()

    int_labels = labels[idx]
    pcs = adata.obsm["X_pca"]

    # Groupings for the sorted matrix: Leiden clusters in dendrogram order, or digits 0-9.
    groupings = {
        "leiden": [np.flatnonzero(clusters == c) for c in cluster_order],
        "label": [np.flatnonzero(int_labels == d) for d in range(N_CLASSES)],
    }
    # Orderings within each group. Subsample order is already random, so "random"
    # just keeps rows in their original order.
    within_orders = {
        "random": lambda members: members,
        "pc1": lambda members: members[within_cluster_order(pcs[members])],
    }

    sortings = {
        group: {
            within: {
                "order": np.concatenate([fn(m) for m in groups]),
                "boundaries": np.cumsum([len(m) for m in groups])[:-1],
            }
            for within, fn in within_orders.items()
        }
        for group, groups in groupings.items()
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUT_DIR.glob("matrix_sorted_*.png"):
        stale.unlink()
    Image.fromarray(pixels).save(OUT_DIR / "matrix_original.png", optimize=True)
    for group, by_within in sortings.items():
        for within, sorting in by_within.items():
            Image.fromarray(pixels[sorting["order"]]).save(
                OUT_DIR / f"matrix_sorted_{group}_{within}.png", optimize=True
            )

    cluster_summaries = []
    start = 0
    for c, part in zip(cluster_order, groupings["leiden"]):
        counts = np.bincount(int_labels[part], minlength=N_CLASSES)
        cluster_summaries.append(
            {
                "id": c,
                "start": start,
                "size": len(part),
                "labelCounts": counts.tolist(),
                "majorityLabel": int(counts.argmax()),
                "purity": round(float(counts.max() / counts.sum()), 4),
            }
        )
        start += len(part)

    meta = {
        "params": vars(args),
        "nSamples": args.n_samples,
        "nPixels": N_PIXELS,
        "nClusters": len(cluster_order),
        "clusters": cluster_summaries,
        # Per-row arrays, indexed by row of matrix_original.png.
        "rows": {
            "sourceIndex": idx.tolist(),
            "label": int_labels.tolist(),
            "cluster": clusters.tolist(),
        },
        # Per-row coordinates for each projection, keyed by name (e.g. umap2d, umap3d).
        "projections": {name: np.round(coords, 3).tolist() for name, coords in projections.items()},
        # sortings[group][within].order[i] = original row shown at row i of
        # matrix_sorted_<group>_<within>.png; boundaries are the display rows where a
        # new group (cluster / digit) starts.
        "sortings": {
            group: {
                within: {"order": s["order"].tolist(), "boundaries": s["boundaries"].tolist()}
                for within, s in by_within.items()
            }
            for group, by_within in sortings.items()
        },
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))

    print(f"{args.n_samples} samples -> {len(cluster_order)} Leiden clusters")
    for s in cluster_summaries:
        print(f"  cluster {s['id']:>2}: n={s['size']:>4}  majority={s['majorityLabel']}  purity={s['purity']:.2f}")
    print(f"Wrote outputs to {OUT_DIR}")


if __name__ == "__main__":
    main()
