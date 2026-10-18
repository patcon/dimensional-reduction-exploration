"""Subsample MNIST at several resolutions, cluster it scanpy-style with Leiden, and export sorted matrices.

The source sprite (mnist_images.png) is a 784 x 65000 image: each row is one
28x28 digit flattened. Labels are 65000 one-hot rows of 10 uint8 bytes.

Each digit is zero-padded to 32x32, then average-pooled down to 16x16, 8x8,
4x4 and 2x2. Leiden clusters and matrix sortings come from the full 32x32
pixels (padding doesn't change distances, so this matches 28x28); projections
are computed separately at every resolution.

Outputs (written to ../v1-1/web/public/data/), for each resolution r in RESOLUTIONS:
  matrix_original_r<r>.png
                       N x r*r grayscale, subsample in random order
  matrix_sorted_<group>_<within>_r<r>.png
                       same rows, grouped by Leiden cluster or true label, or all as
                       one group (group = leiden|label|none), ordered within each group
                       randomly or by the group's own PC1 (within = random|pc1)
  meta.json            per-row cluster/label, projections (UMAP / PaCMAP / LocalMAP, 2D + 3D,
                       at every resolution), per-cluster summaries
  evolution/<name>.bin layout snapshots during optimisation, for each projection in meta.json:
                       float32, snapshots x N x dims (iterations listed in meta.json)
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
from sklearn.utils import check_random_state  # noqa: E402
from umap.umap_ import find_ab_params, simplicial_set_embedding  # noqa: E402

IMAGES_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_images.png"
LABELS_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_labels_uint8"
N_TOTAL = 65000
N_PIXELS = 784
PADDED = 32
# Largest first: the 32x32 projections are the reference the others are aligned to in the app.
RESOLUTIONS = (32, 16, 8, 4, 2)
# Iterations at which to snapshot each layout. PaCMAP/LocalMAP use PaCMAP's defaults (450
# iterations total); UMAP's 500 epochs get the same number of snapshots, denser early on.
PACMAP_SNAPSHOTS = [0, 10, 30, 60, 100, 120, 140, 170, 200, 250, 300, 350, 450]
UMAP_SNAPSHOTS = [0, 10, 20, 35, 50, 75, 100, 150, 200, 250, 300, 400, 500]
N_CLASSES = 10

HERE = Path(__file__).parent
RAW_DIR = HERE / "data" / "raw"
OUT_DIR = HERE.parent / "v1-1" / "web" / "public" / "data"


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


def downsample(digits: np.ndarray, side: int) -> np.ndarray:
    """Average-pool N x 28*28 digits, zero-padded to 32x32, down to N x side*side floats in [0, 255]."""
    n = len(digits)
    pad = (PADDED - 28) // 2
    padded = np.pad(digits.reshape(n, 28, 28).astype(np.float32), ((0, 0), (pad, pad), (pad, pad)))
    block = PADDED // side
    return padded.reshape(n, side, block, side, block).mean(axis=(2, 4)).reshape(n, side * side)


def umap_snapshots(ad: AnnData, rep: np.ndarray, dims: int, seed: int) -> np.ndarray:
    """What sc.tl.umap computes (same defaults), but snapshotted at UMAP_SNAPSHOTS epochs.

    Calls umap's simplicial_set_embedding directly, as scanpy does, with a list of epochs
    so it also returns the intermediate layouts. The last snapshot is sc.tl.umap's result.
    """
    a, b = find_ab_params(spread=1.0, min_dist=0.5)
    _, aux = simplicial_set_embedding(
        data=rep,
        graph=ad.obsp["connectivities"].tocoo(copy=True),
        n_components=dims,
        initial_alpha=1.0,
        a=a,
        b=b,
        gamma=1.0,
        negative_sample_rate=5,
        n_epochs=UMAP_SNAPSHOTS,
        init="spectral",
        random_state=check_random_state(seed),
        metric="euclidean",
        metric_kwds={},
        densmap=False,
        densmap_kwds={},
        output_dens=False,
    )
    return np.stack(aux["embedding_list"])


def project(X: np.ndarray, n_pcs: int, n_neighbors: int, seed: int) -> dict[str, tuple[list[int], np.ndarray]]:
    """UMAP (scanpy-style, via PCA when there are enough pixels), PaCMAP and LocalMAP, each in 2D and 3D.

    Returns, per projection, the snapshot iterations and a snapshots x N x dims array whose
    last entry is the final layout.
    """
    ad = AnnData(X=X)
    if X.shape[1] > n_pcs:
        sc.pp.pca(ad, n_comps=n_pcs, random_state=seed)
        sc.pp.neighbors(ad, n_neighbors=n_neighbors, n_pcs=n_pcs, random_state=seed)
        rep = ad.obsm["X_pca"][:, :n_pcs]
    else:
        # Too few pixels to reduce: build the kNN graph on the pixels themselves.
        sc.pp.neighbors(ad, n_neighbors=n_neighbors, use_rep="X", random_state=seed)
        rep = X
    out = {}
    for dims in (2, 3):
        out[f"umap{dims}d"] = (UMAP_SNAPSHOTS, umap_snapshots(ad, rep, dims, seed))
    # PaCMAP and LocalMAP take raw pixels; they apply their own PCA preprocessing above 100 dims.
    for name, cls in (("pacmap", pacmap.PaCMAP), ("localmap", pacmap.LocalMAP)):
        for dims in (2, 3):
            reducer = cls(
                n_components=dims, random_state=seed, intermediate=True, intermediate_snapshots=PACMAP_SNAPSHOTS
            )
            out[f"{name}{dims}d"] = (PACMAP_SNAPSHOTS, reducer.fit_transform(X))
    return out


def within_cluster_order(X: np.ndarray) -> np.ndarray:
    """Order rows of one cluster along its own first principal component."""
    if len(X) < 3:
        return np.arange(len(X))
    centered = X - X.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    return np.argsort(centered @ vt[0])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-n", "--n-samples", type=int, default=10000)
    parser.add_argument("--n-pcs", type=int, default=50)
    parser.add_argument("--n-neighbors", type=int, default=15)
    parser.add_argument("--resolution", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    sprite, labels = load_mnist()

    rng = np.random.default_rng(args.seed)
    idx = rng.choice(N_TOTAL, size=args.n_samples, replace=False)
    by_res = {r: downsample(sprite[idx], r) for r in RESOLUTIONS}

    adata = AnnData(X=by_res[PADDED] / 255.0)
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
    # Keyed like "umap2d_r8": method, dimensionality, resolution.
    projections = {}
    evolution = {}
    for r in RESOLUTIONS:
        print(f"Projecting {r}x{r}")
        for name, (iterations, snapshots) in project(by_res[r] / 255.0, args.n_pcs, args.n_neighbors, args.seed).items():
            projections[f"{name}_r{r}"] = snapshots[-1]
            evolution[f"{name}_r{r}"] = (iterations, snapshots)
    # Hierarchical ordering of clusters so similar clusters sit next to each other.
    sc.tl.dendrogram(adata, groupby="leiden", n_pcs=args.n_pcs)

    cluster_order = [int(c) for c in adata.uns["dendrogram_leiden"]["categories_ordered"]]
    clusters = adata.obs["leiden"].astype(int).to_numpy()

    int_labels = labels[idx]
    pcs = adata.obsm["X_pca"]

    # Groupings for the sorted matrix: everything as one group, Leiden clusters in
    # dendrogram order, or digits 0-9.
    groupings = {
        "none": [np.arange(args.n_samples)],
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
    for stale in OUT_DIR.glob("matrix_*.png"):
        stale.unlink()
    evo_dir = OUT_DIR / "evolution"
    evo_dir.mkdir(exist_ok=True)
    for stale in evo_dir.glob("*.bin"):
        stale.unlink()
    for name, (_, snapshots) in evolution.items():
        snapshots.astype("<f4").tofile(evo_dir / f"{name}.bin")
    for r in RESOLUTIONS:
        pixels = np.round(by_res[r]).astype(np.uint8)
        Image.fromarray(pixels).save(OUT_DIR / f"matrix_original_r{r}.png", optimize=True)
        for group, by_within in sortings.items():
            for within, sorting in by_within.items():
                Image.fromarray(pixels[sorting["order"]]).save(
                    OUT_DIR / f"matrix_sorted_{group}_{within}_r{r}.png", optimize=True
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
        # Side length of each available resolution, largest first.
        "resolutions": list(RESOLUTIONS),
        "nClusters": len(cluster_order),
        "clusters": cluster_summaries,
        # Per-row arrays, indexed by row of matrix_original_r<r>.png.
        "rows": {
            "sourceIndex": idx.tolist(),
            "label": int_labels.tolist(),
            "cluster": clusters.tolist(),
        },
        # Per-row coordinates for each projection, keyed by name (e.g. umap2d_r32, pacmap3d_r4).
        "projections": {name: np.round(coords, 3).tolist() for name, coords in projections.items()},
        # Optimisation snapshots per projection, loaded on demand from evolution/<name>.bin
        # (float32, snapshots x N x dims); the last snapshot is the projection itself.
        "evolution": {name: {"iterations": iterations} for name, (iterations, _) in evolution.items()},
        # sortings[group][within].order[i] = original row shown at row i of
        # matrix_sorted_<group>_<within>_r<r>.png; boundaries are the display rows where a
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
