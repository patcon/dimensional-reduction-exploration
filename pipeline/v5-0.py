"""Embed a balanced sample of MNIST, for v5.0's map and music.

The source sprite (mnist_images.png) is a 784 x 65000 image: each row is one
28x28 digit flattened. Labels are 65000 one-hot rows of 10 uint8 bytes.

v5.0 walks a fixed map of digits, after "Density clusters on deskewed digits" (whose
digits are left as they are here, not deskewed): a balanced sample, with its principal
components for the walk's nearest neighbours and Leiden,
a 10-dimensional UMAP for HDBSCAN to find dense regions in, and PaCMAP's 2D map to
draw them on. All are worked out once, on every digit; the browser keeps the ones
whose labels are chosen.

Outputs (written to ../v5-0/web/public/data/):
  digits.png   N x 784 grayscale: the digits, in random order
  pcs.bin      float32, N x n_pcs: their principal components
  umap.bin     float32, N x 10: UMAP of the components (15 neighbours, min_dist 0)
  xy.bin       float32, N x 2: PaCMAP of the components, the map
  meta.json    per-row source index and label
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
import umap  # noqa: E402
from anndata import AnnData  # noqa: E402
from PIL import Image  # noqa: E402

IMAGES_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_images.png"
LABELS_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_labels_uint8"
N_TOTAL = 65000
N_PIXELS = 784
N_CLASSES = 10
UMAP_DIMS = 10
UMAP_NEIGHBORS = 15

HERE = Path(__file__).parent
RAW_DIR = HERE / "data" / "raw"
OUT_DIR = HERE.parent / "v5-0" / "web" / "public" / "data"


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-digit", type=int, default=200)
    parser.add_argument("--n-pcs", type=int, default=50)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    sprite, labels = load_mnist()

    # A balanced sample, then shuffled so no label sits together in the files.
    rng = np.random.default_rng(args.seed)
    idx = np.concatenate([rng.choice(np.flatnonzero(labels == d), size=args.per_digit, replace=False) for d in range(N_CLASSES)])
    idx = rng.permutation(idx)
    pixels = sprite[idx]
    int_labels = labels[idx]
    n = len(idx)

    adata = AnnData(X=pixels.astype(np.float32) / 255.0)
    sc.pp.pca(adata, n_comps=args.n_pcs, random_state=args.seed)
    pcs = adata.obsm["X_pca"].astype(np.float32)

    print("UMAP…")
    embedding = umap.UMAP(n_components=UMAP_DIMS, n_neighbors=UMAP_NEIGHBORS, min_dist=0.0, random_state=args.seed).fit_transform(pcs)
    print("PaCMAP…")
    xy = pacmap.PaCMAP(n_components=2, random_state=args.seed).fit_transform(pcs, init="pca")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(OUT_DIR / "digits.png", optimize=True)
    pcs.tofile(OUT_DIR / "pcs.bin")
    embedding.astype(np.float32).tofile(OUT_DIR / "umap.bin")
    xy.astype(np.float32).tofile(OUT_DIR / "xy.bin")
    meta = {
        "params": vars(args),
        "nSamples": n,
        "nPixels": N_PIXELS,
        "nPcs": args.n_pcs,
        "umapDims": UMAP_DIMS,
        # Per-row arrays, indexed by row of digits.png (and of each .bin).
        "rows": {"sourceIndex": idx.tolist(), "label": int_labels.tolist()},
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))
    print(f"Wrote {n} digits, {args.n_pcs} PCs, a {UMAP_DIMS}-D UMAP and a 2-D PaCMAP to {OUT_DIR}")


if __name__ == "__main__":
    main()
