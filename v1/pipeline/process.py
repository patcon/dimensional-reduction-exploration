"""Subsample MNIST, cluster it scanpy-style with Leiden, and export a cluster-sorted matrix.

The source sprite (mnist_images.png) is a 784 x 65000 image: each row is one
28x28 digit flattened. Labels are 65000 one-hot rows of 10 uint8 bytes.

Outputs (written to ../web/public/data/):
  matrix_original.png  N x 784 grayscale, subsample in random order
  matrix_sorted_leiden.png  same rows, reordered so Leiden clusters are contiguous
  matrix_sorted_label.png   same rows, reordered by true digit label
  meta.json            per-row cluster/label, projections (UMAP 2D/3D), per-cluster summaries
"""

import argparse
import json
import urllib.request
from pathlib import Path

import numpy as np
import scanpy as sc
from anndata import AnnData
from PIL import Image

IMAGES_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_images.png"
LABELS_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_labels_uint8"
N_TOTAL = 65000
N_PIXELS = 784
N_CLASSES = 10

HERE = Path(__file__).parent
RAW_DIR = HERE / "data" / "raw"
OUT_DIR = HERE.parent / "web" / "public" / "data"


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
    # Hierarchical ordering of clusters so similar clusters sit next to each other.
    sc.tl.dendrogram(adata, groupby="leiden", n_pcs=args.n_pcs)

    cluster_order = [int(c) for c in adata.uns["dendrogram_leiden"]["categories_ordered"]]
    clusters = adata.obs["leiden"].astype(int).to_numpy()

    int_labels = labels[idx]
    pcs = adata.obsm["X_pca"]

    # Leiden sort: clusters in dendrogram order, then each cluster's own PC1.
    order_parts = []
    for c in cluster_order:
        members = np.flatnonzero(clusters == c)
        order_parts.append(members[within_cluster_order(pcs[members])])

    # Label sort: digits 0-9, then Leiden cluster (dendrogram order) so you can see
    # how each digit splits across clusters, then PC1 within each sub-block.
    label_parts = []
    for digit in range(N_CLASSES):
        for c in cluster_order:
            members = np.flatnonzero((int_labels == digit) & (clusters == c))
            label_parts.append(members[within_cluster_order(pcs[members])])
    label_order = np.concatenate(label_parts)
    label_sizes = np.bincount(int_labels, minlength=N_CLASSES)

    sortings = {
        "leiden": {
            "order": np.concatenate(order_parts),
            "boundaries": np.cumsum([len(p) for p in order_parts])[:-1],
        },
        "label": {
            "order": label_order,
            "boundaries": np.cumsum(label_sizes)[:-1],
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(OUT_DIR / "matrix_original.png", optimize=True)
    for name, sorting in sortings.items():
        Image.fromarray(pixels[sorting["order"]]).save(OUT_DIR / f"matrix_sorted_{name}.png", optimize=True)

    cluster_summaries = []
    start = 0
    for c, part in zip(cluster_order, order_parts):
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
        # sortings[name].order[i] = original row shown at row i of matrix_sorted_<name>.png;
        # boundaries are the display rows where a new group (cluster / digit) starts.
        "sortings": {
            name: {"order": s["order"].tolist(), "boundaries": s["boundaries"].tolist()}
            for name, s in sortings.items()
        },
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))

    print(f"{args.n_samples} samples -> {len(cluster_order)} Leiden clusters")
    for s in cluster_summaries:
        print(f"  cluster {s['id']:>2}: n={s['size']:>4}  majority={s['majorityLabel']}  purity={s['purity']:.2f}")
    print(f"Wrote outputs to {OUT_DIR}")


if __name__ == "__main__":
    main()
