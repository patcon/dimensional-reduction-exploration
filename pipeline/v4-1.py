"""Subsample MNIST into a pool of digits for v4.1 to read out as valence traces, alongside live participants.

The source sprite (mnist_images.png) is a 784 x 65000 image: each row is one
28x28 digit flattened. Labels are 65000 one-hot rows of 10 uint8 bytes.

v4.1 uses digits as stand-in data for a valence visualisation: each digit's pixels,
read in order, are one participant's valence over time. Which digits take part
(filtered by label, then subsampled) is picked in the browser, which also builds the
kNN graph and runs Leiden on them. This exports the pool to pick from, with the
principal components to cluster on, and the PCA itself (its mean and loadings), so the
browser can project a live participant's drawing onto the same components.

Outputs (written to ../v4-1/web/public/data/):
  matrix.png   N x 784 grayscale, the pool in random order
  pcs.bin      float32, N x n_pcs: the pool's principal components
  pca.bin      float32, 784 means then n_pcs x 784 loadings: pcs = (pixels / 255 - mean) @ loadings.T
  meta.json    per-row source index and label

and, kept out of the site (only the browser's check uses it), to data/v4-1/:
  leiden_reference.json  for a few picks of digits: scanpy's kNN connectivities on their
                         principal components, and its Leiden clusters and their modularity
"""

import argparse
import json
import urllib.request
from pathlib import Path

import igraph as ig
import numpy as np
import scanpy as sc
from anndata import AnnData
from PIL import Image

IMAGES_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_images.png"
LABELS_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_labels_uint8"
N_TOTAL = 65000
N_PIXELS = 784
N_CLASSES = 10

# Picks of digits for the reference: (digits, how many, Leiden resolution).
REFERENCE_CASES = [
    (list(range(N_CLASSES)), 200, 1.0),
    (list(range(N_CLASSES)), 60, 0.5),
    ([3, 5, 8], 150, 1.0),
    ([7], 100, 1.0),
    ([1, 7], 40, 2.0),
]
# What the browser uses by default.
N_NEIGHBORS = 15
N_ITERATIONS = 2

HERE = Path(__file__).parent
RAW_DIR = HERE / "data" / "raw"
OUT_DIR = HERE.parent / "v4-1" / "web" / "public" / "data"
REFERENCE_DIR = HERE / "data" / "v4-1"


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


def reference_case(pcs: np.ndarray, labels: np.ndarray, digits: list[int], n: int, resolution: float, seed: int) -> dict:
    """Cluster one pick of digits scanpy's way, on the pool's principal components."""
    pool = np.flatnonzero(np.isin(labels, digits))
    rows = np.random.default_rng(seed).choice(pool, size=n, replace=False)
    adata = AnnData(X=np.zeros((n, 1), dtype=np.float32))
    adata.obsm["X_pca"] = pcs[rows]
    sc.pp.neighbors(adata, n_neighbors=N_NEIGHBORS, use_rep="X_pca", random_state=seed)
    sc.tl.leiden(
        adata,
        resolution=resolution,
        flavor="igraph",
        n_iterations=N_ITERATIONS,
        directed=False,
        random_state=seed,
    )
    membership = adata.obs["leiden"].astype(int).to_numpy()
    conn = adata.obsp["connectivities"].tocoo()
    upper = conn.row < conn.col
    i, j, w = conn.row[upper], conn.col[upper], conn.data[upper]
    graph = ig.Graph(n=n, edges=list(zip(i.tolist(), j.tolist())), directed=False)
    modularity = graph.modularity(membership.tolist(), weights=w.tolist(), resolution=resolution)
    return {
        "digits": digits,
        "resolution": resolution,
        "nNeighbors": N_NEIGHBORS,
        "nIterations": N_ITERATIONS,
        "rows": rows.tolist(),
        # Each undirected edge once (i < j), with its connectivity weight.
        "edges": {"i": i.tolist(), "j": j.tolist(), "w": np.round(w, 6).tolist()},
        "membership": membership.tolist(),
        "modularity": modularity,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-n", "--n-samples", type=int, default=5000)
    parser.add_argument("--n-pcs", type=int, default=50)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    sprite, labels = load_mnist()

    rng = np.random.default_rng(args.seed)
    idx = rng.choice(N_TOTAL, size=args.n_samples, replace=False)
    pixels = sprite[idx]
    int_labels = labels[idx]

    # The same PCA as the v1 pipelines, which the browser's kNN graph is built on.
    adata = AnnData(X=pixels.astype(np.float32) / 255.0)
    sc.pp.pca(adata, n_comps=args.n_pcs, random_state=args.seed)
    pcs = adata.obsm["X_pca"].astype(np.float32)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(OUT_DIR / "matrix.png", optimize=True)
    pcs.tofile(OUT_DIR / "pcs.bin")
    # The PCA, to project drawings the browser makes onto the same components.
    mean = np.asarray(adata.X.mean(axis=0), dtype=np.float32).ravel()
    loadings = adata.varm["PCs"].T.astype(np.float32)
    np.concatenate([mean, loadings.ravel()]).tofile(OUT_DIR / "pca.bin")
    projected = (adata.X - mean) @ loadings.T
    assert np.allclose(projected, pcs, atol=1e-3), "the exported PCA doesn't reproduce the PCs"
    meta = {
        "params": vars(args),
        "nSamples": args.n_samples,
        "nPixels": N_PIXELS,
        "nPcs": args.n_pcs,
        # Per-row arrays, indexed by row of matrix.png (and of pcs.bin).
        "rows": {"sourceIndex": idx.tolist(), "label": int_labels.tolist()},
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))
    print(f"Wrote {args.n_samples} digits and {args.n_pcs} PCs to {OUT_DIR}")

    REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    cases = []
    for digits, n, resolution in REFERENCE_CASES:
        case = reference_case(pcs, int_labels, digits, n, resolution, args.seed)
        cases.append(case)
        print(
            f"  reference: digits {''.join(map(str, digits))}, n={n}, resolution {resolution}: "
            f"{len(set(case['membership']))} clusters, modularity {case['modularity']:.4f}"
        )
    (REFERENCE_DIR / "leiden_reference.json").write_text(json.dumps({"cases": cases}))
    print(f"Wrote Leiden reference to {REFERENCE_DIR}")


if __name__ == "__main__":
    main()
