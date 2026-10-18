"""Subsample MNIST, run PaCMAP once, and export what the browser needs to rerun its optimisation live.

The source sprite (mnist_images.png) is a 784 x 65000 image: each row is one
28x28 digit flattened. Labels are 65000 one-hot rows of 10 uint8 bytes.

PaCMAP samples its three pair sets once, up front; only the weights on them change
during optimisation. So the pairs and the initial layout are everything the
browser needs to replay (or freely remix) the optimisation. The full PaCMAP run
is kept as a reference to check the browser's engine against.

Outputs (written to ../v2-0/web/public/data/):
  pairs_nb.bin   uint32, N*n_neighbors x 2 (i, j): neighbour pairs
  pairs_mn.bin   uint32, N*n_MN x 2: mid-near pairs
  pairs_fp.bin   uint32, N*n_FP x 2: far pairs
  init.bin       float32, N x 2: the layout before the first iteration
  reference.bin  float32, snapshots x N x 2: PaCMAP's layout every SNAPSHOT_EVERY iterations
  meta.json      labels, pair counts, snapshot iterations, the weight schedule and Adam params

--check replays the optimisation from the exported files, with PaCMAP's own kernels
(must match reference.bin exactly) and with an independent numpy version (must
match closely), to prove the exports are complete.
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
from PIL import Image  # noqa: E402

IMAGES_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_images.png"
LABELS_URL = "https://storage.googleapis.com/learnjs-data/model-builder/mnist_labels_uint8"
N_TOTAL = 65000
N_PIXELS = 784
N_CLASSES = 10

# PaCMAP's defaults, written out so the browser gets them from meta.json rather than hardcoding.
PHASES = (100, 100, 250)
N_ITERS = sum(PHASES)
W_MN_INIT = 1000.0
LR = 1.0
BETA1 = 0.9
BETA2 = 0.999
EPS = 1e-7
SNAPSHOT_EVERY = 10
SNAPSHOTS = list(range(0, N_ITERS + 1, SNAPSHOT_EVERY))

HERE = Path(__file__).parent
RAW_DIR = HERE / "data" / "raw"
OUT_DIR = HERE.parent / "v2-0" / "web" / "public" / "data"


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


def schedule(itr: int) -> tuple[float, float, float]:
    """PaCMAP's (w_nb, w_mn, w_fp) at an iteration; mirrors pacmap.find_weight."""
    p1, p2, _ = PHASES
    if itr < p1:
        t = itr / p1
        return 2.0, (1 - t) * W_MN_INIT + t * 3.0, 1.0
    if itr < p1 + p2:
        return 3.0, 3.0, 1.0
    return 1.0, 0.0, 1.0


def run(args: argparse.Namespace) -> None:
    sprite, labels = load_mnist()

    rng = np.random.default_rng(args.seed)
    idx = rng.choice(N_TOTAL, size=args.n_samples, replace=False)
    X = sprite[idx].astype(np.float32) / 255.0

    reducer = pacmap.PaCMAP(
        n_components=2,
        num_iters=PHASES,
        lr=LR,
        random_state=args.seed,
        intermediate=True,
        intermediate_snapshots=SNAPSHOTS,
        verbose=True,
    )
    reducer.fit(X, save_pairs=True)
    snapshots = np.asarray(reducer.intermediate_states, dtype=np.float32)
    assert snapshots.shape == (len(SNAPSHOTS), args.n_samples, 2), snapshots.shape

    pairs = {"nb": reducer.pair_neighbors, "mn": reducer.pair_MN, "fp": reducer.pair_FP}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, p in pairs.items():
        p.astype(np.uint32).tofile(OUT_DIR / f"pairs_{name}.bin")
    snapshots[0].tofile(OUT_DIR / "init.bin")
    snapshots.tofile(OUT_DIR / "reference.bin")

    meta = {
        "nSamples": args.n_samples,
        "seed": args.seed,
        "labels": labels[idx].tolist(),
        "sourceIndex": idx.tolist(),
        "pairs": {name: {"count": len(p), "perPoint": len(p) // args.n_samples} for name, p in pairs.items()},
        "reference": {"iterations": SNAPSHOTS},
        "schedule": {"phases": list(PHASES), "wMnInit": W_MN_INIT},
        "adam": {"lr": LR, "beta1": BETA1, "beta2": BETA2, "eps": EPS},
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta))

    counts = ", ".join(f"{name} {len(p)}" for name, p in pairs.items())
    print(f"{args.n_samples} samples -> pairs: {counts}; {len(SNAPSHOTS)} reference snapshots -> {OUT_DIR}")


def pacmap_grad(Y: np.ndarray, pairs: dict[str, np.ndarray], w: tuple[float, float, float]) -> np.ndarray:
    """Vectorised pacmap.pacmap_grad (float32, same kernels and signs)."""
    grad = np.zeros_like(Y)
    for (name, num), weight in zip((("nb", 10.0), ("mn", 10000.0), ("fp", 1.0)), w):
        i, j = pairs[name][:, 0], pairs[name][:, 1]
        y_ij = Y[i] - Y[j]
        d_ij = np.float32(1.0) + (y_ij**2).sum(axis=1)
        if name == "fp":
            c = -np.float32(weight * 2.0) / (np.float32(1.0) + d_ij) ** 2
        else:
            c = np.float32(weight * 2.0 * num) / (np.float32(num) + d_ij) ** 2
        g = c[:, None] * y_ij
        np.add.at(grad, i, g)
        np.add.at(grad, j, -g)
    return grad


def check(args: argparse.Namespace) -> None:
    """Replay the optimisation from the exported files two ways and compare against reference.bin.

    1. With PaCMAP's own numba kernels: must match exactly, proving the exports are complete.
    2. With the independent numpy pacmap_grad above, as the browser engine will be. Float
       summation order differs, and Adam's m/sqrt(v) amplifies that for the few points whose
       gradient is near zero, so a handful of points drift ~1e-2 while the rest agree to ~1e-6.
       Judge it on a high percentile of the error rather than the max.
    """
    from pacmap.pacmap import pacmap_grad as numba_grad
    from pacmap.pacmap import update_embedding_adam

    meta = json.loads((OUT_DIR / "meta.json").read_text())
    n = meta["nSamples"]
    pairs = {
        name: np.fromfile(OUT_DIR / f"pairs_{name}.bin", dtype=np.uint32).reshape(-1, 2).astype(np.int32)
        for name in ("nb", "mn", "fp")
    }
    init = np.fromfile(OUT_DIR / "init.bin", dtype=np.float32).reshape(n, 2)
    iterations = meta["reference"]["iterations"]
    reference = np.fromfile(OUT_DIR / "reference.bin", dtype=np.float32).reshape(len(iterations), n, 2)
    targets = {it: k for k, it in enumerate(iterations) if 0 < it <= args.check_iters}

    def replay(step) -> list[np.ndarray]:
        """Per-point error against each reference snapshot up to --check-iters."""
        Y = init.copy()
        m = np.zeros_like(Y)
        v = np.zeros_like(Y)
        errors = []
        for itr in range(args.check_iters):
            step(Y, m, v, itr)
            if itr + 1 in targets:
                errors.append(np.abs(Y - reference[targets[itr + 1]]).max(axis=1))
        return errors

    def numba_step(Y, m, v, itr):
        w_nb, w_mn, w_fp = (np.float32(w) for w in schedule(itr))
        grad = numba_grad(Y, pairs["nb"], pairs["mn"], pairs["fp"], w_nb, w_mn, w_fp)
        update_embedding_adam(Y, grad, m, v, BETA1, BETA2, LR, itr)

    def numpy_step(Y, m, v, itr):
        grad = pacmap_grad(Y, pairs, schedule(itr))
        lr_t = LR * np.sqrt(1.0 - BETA2 ** (itr + 1)) / (1.0 - BETA1 ** (itr + 1))
        m += (1 - BETA1) * (grad - m)
        v += (1 - BETA2) * (grad**2 - v)
        Y -= np.float32(lr_t) * m / (np.sqrt(v) + np.float32(EPS))

    exact = max(e.max() for e in replay(numba_step))
    print(f"exports, replayed with PaCMAP's kernels: max error {exact:.2e}")

    spread = np.abs(reference).max()
    worst = 0.0
    for it, e in zip(sorted(targets), replay(numpy_step)):
        p = np.percentile(e, args.percentile)
        worst = max(worst, p / spread)
        print(f"numpy reimplementation, iteration {it:4d}: p{args.percentile:g} {p:.2e}, max {e.max():.2e}")

    ok = exact == 0.0 and worst < args.tolerance
    print(
        f"{'OK' if ok else 'MISMATCH'}: exact replay {'matches' if exact == 0.0 else 'differs'}; "
        f"numpy p{args.percentile:g} error {worst:.2e} of layout spread {spread:.2f} (tolerance {args.tolerance:g})"
    )
    raise SystemExit(0 if ok else 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-n", "--n-samples", type=int, default=20000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--check", action="store_true", help="verify the exported files instead of generating them")
    parser.add_argument("--check-iters", type=int, default=100)
    parser.add_argument(
        "--percentile", type=float, default=99, help="per-point error percentile the numpy replay is judged on"
    )
    parser.add_argument("--tolerance", type=float, default=1e-4, help="as a fraction of the layout spread")
    args = parser.parse_args()
    if args.check:
        check(args)
    else:
        run(args)


if __name__ == "__main__":
    main()
