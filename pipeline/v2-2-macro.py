"""Score v2.2's single-slider modes against PaCMAP's own run, and fit mode F's curve.

Each mode maps a slider position s in [0, 1] to the three weights (v2-2/web/src/macro.ts; the
curves here mirror it). Sliding it top to bottom at a steady pace, one step per iteration over
PaCMAP's 450, is replayed from v2-2.py's exports with PaCMAP's own kernels and Adam, and its
final layout compared with PaCMAP's:

  disparity  Procrustes disparity (0 is the same layout up to rotation, scale and shift)
  knn        how many of each digit's 10 nearest neighbours in PaCMAP's layout are among its 10 here

B (the slider as the clock) replays PaCMAP's weights at each iteration, so it matches by construction.
--fit fits F's knots (Nelder-Mead on the disparity) and prints them for macro.ts.

  uv run v2-2-macro.py                 # score every mode, 10k digits in 2D
  uv run v2-2-macro.py --fit           # fit F, then score every mode with it
"""

import argparse
import json
import time
from pathlib import Path

import numba

numba.config.THREADING_LAYER = "workqueue"

import numpy as np  # noqa: E402
from pacmap.pacmap import pacmap_grad, update_embedding_adam  # noqa: E402
from scipy.optimize import minimize  # noqa: E402
from scipy.spatial import procrustes  # noqa: E402
from sklearn.neighbors import NearestNeighbors  # noqa: E402

HERE = Path(__file__).parent
DATA_DIR = HERE.parent / "v2-2" / "web" / "public" / "data"
REFERENCE_DIR = HERE / "data" / "v2-2"

PHASES = (100, 100, 250)
N_ITERS = sum(PHASES)
W_MN_INIT = 1000.0
BETA1, BETA2, LR = 0.9, 0.999, 1.0
KNN = 10


def smoothstep(t):
    return t * t * (3 - 2 * t)


def pacmap_weights(itr: float):
    """Signed (nb, mn, fp), as schedule.ts's pacmapWeights."""
    p1, p2, _ = PHASES
    if itr < p1:
        t = itr / p1
        return 2.0, (1 - t) * W_MN_INIT + t * 3.0, -1.0
    if itr < p1 + p2:
        return 3.0, 3.0, -1.0
    return 1.0, 0.0, -1.0


SCRUB_TRAVEL = (0.6, 0.15, 0.25)


def scrub(s):
    p1, p2, p3 = PHASES
    a, b, _ = SCRUB_TRAVEL
    if s < a:
        it = s / a * p1
    elif s < a + b:
        it = p1 + (s - a) / b * p2
    else:
        it = p1 + p2 + min((s - a - b) / (1 - a - b) * p3, p3 - 1)
    return pacmap_weights(it)


def eased(knots, s):
    ks, nb, mn = knots["s"], knots["nb"], knots["mn"]
    if s >= ks[-1]:
        return nb[-1], 0.0, -1.0
    k = 0
    while k < len(ks) - 2 and s > ks[k + 1]:
        k += 1
    t = smoothstep(np.clip((s - ks[k]) / (ks[k + 1] - ks[k]), 0, 1))
    lerp = lambda a, b: np.exp(np.log(a) + (np.log(b) - np.log(a)) * t)  # noqa: E731
    return lerp(nb[k], nb[k + 1]), lerp(mn[k], mn[k + 1]), -1.0


C_KNOTS = {"s": [0, 0.5, 0.9, 0.95], "nb": [2, 3, 1, 1], "mn": [1000, 3, 0.1, 0.1]}


def global_local(s):
    nb = 2 + (1 - 2) * s
    if s >= 0.95:
        return nb, 0.0, -1.0
    ratio = np.exp(np.log(500) + (np.log(0.01) - np.log(500)) * s / 0.95)
    return nb, nb * ratio, -1.0


E_WAYPOINTS = np.array([[2, 1000, -1], [3, 3, -1], [1, 0, -1]], dtype=float)


def arc(s):
    half = 0 if s < 0.5 else 1
    t = smoothstep(np.clip((s - 0.5) * 2 if half else s * 2, 0, 1))
    a, b = E_WAYPOINTS[half], E_WAYPOINTS[half + 1]
    ua, ub = a / np.linalg.norm(a), b / np.linalg.norm(b)
    omega = np.arccos(np.clip(ua @ ub, -1, 1))
    v = (np.sin((1 - t) * omega) * ua + np.sin(t * omega) * ub) / np.sin(omega)
    strength = np.exp(np.log(np.linalg.norm(a)) + (np.log(np.linalg.norm(b)) - np.log(np.linalg.norm(a))) * t)
    nb, mn, fp = v * strength
    return nb, (0.0 if mn < 1e-3 else mn), fp


def sweep(curve):
    """The weights a steady top-to-bottom slide gives at each iteration."""
    return [curve(k / (N_ITERS - 1)) for k in range(N_ITERS)]


def load(size: str, dim: int):
    d = DATA_DIR / size
    meta = json.loads((d / "meta.json").read_text())
    n = meta["nSamples"]
    pairs = [np.fromfile(d / f"pairs_{t}.bin", dtype=np.uint32).reshape(-1, 2).astype(np.int32) for t in ("nb", "mn", "fp")]
    init = np.fromfile(d / f"init_{dim}d.bin", dtype=np.float32).reshape(n, dim)
    snaps = len(meta["reference"]["iterations"])
    final = np.fromfile(REFERENCE_DIR / size / f"reference_{dim}d.bin", dtype=np.float32).reshape(snaps, n, dim)[-1]
    return pairs, init, final


def replay(weights, pairs, init):
    Y = init.copy()
    m = np.zeros_like(Y)
    v = np.zeros_like(Y)
    for itr, (nb, mn, fp) in enumerate(weights):
        # PaCMAP's kernels take the far-pair weight as a repulsion.
        grad = pacmap_grad(Y, *pairs, np.float32(nb), np.float32(mn), np.float32(-fp))
        update_embedding_adam(Y, grad, m, v, BETA1, BETA2, LR, itr)
    return Y


def knn_overlap(Y, ref):
    a = NearestNeighbors(n_neighbors=KNN + 1).fit(Y).kneighbors(Y, return_distance=False)[:, 1:]
    b = NearestNeighbors(n_neighbors=KNN + 1).fit(ref).kneighbors(ref, return_distance=False)[:, 1:]
    return np.mean([len(set(x) & set(y)) / KNN for x, y in zip(a, b)])


def disparity(Y, ref):
    return procrustes(ref.astype(np.float64), Y.astype(np.float64))[2]


def knots_from(p):
    """F's parameters, unconstrained, as knots: [s1, s2, log nb0..2, log mn0, log mn1]."""
    s1 = 0.1 + 0.75 / (1 + np.exp(-p[0]))
    s2 = s1 + 0.05 + (0.9 - s1) / (1 + np.exp(-p[1]))
    nb = list(np.exp(p[2:5]))
    return {"s": [0, s1, s2, s2 + 0.05], "nb": nb + [nb[-1]], "mn": [float(np.exp(p[5])), float(np.exp(p[6])), 0.1, 0.1]}


def params_from(knots):
    s1, s2 = knots["s"][1], knots["s"][2]
    logit = lambda x: np.log(x / (1 - x))  # noqa: E731
    return np.array(
        [logit((s1 - 0.1) / 0.75), logit((s2 - s1 - 0.05) / (0.9 - s1)), *np.log(knots["nb"][:3]), np.log(knots["mn"][0]), np.log(knots["mn"][1])]
    )


def fit(pairs, init, final, max_evals):
    evals = 0

    def loss(p):
        nonlocal evals
        evals += 1
        d = disparity(replay(sweep(lambda s: eased(knots_from(p), s)), pairs, init), final)
        if evals % 10 == 0:
            print(f"  eval {evals}: disparity {d:.4f}", flush=True)
        return d

    result = minimize(loss, params_from(C_KNOTS), method="Nelder-Mead", options={"maxfev": max_evals, "xatol": 1e-3, "fatol": 1e-5})
    return knots_from(result.x)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--size", default="10k")
    parser.add_argument("--dim", type=int, default=2)
    parser.add_argument("--fit", action="store_true", help="fit F's knots before scoring")
    parser.add_argument("--max-evals", type=int, default=250)
    args = parser.parse_args()

    pairs, init, final = load(args.size, args.dim)
    f_knots = C_KNOTS
    if args.fit:
        t = time.time()
        f_knots = fit(pairs, init, final, args.max_evals)
        rounded = {k: [round(float(x), 3) for x in v] for k, v in f_knots.items()}
        print(f"F fitted in {time.time() - t:.0f}s: {json.dumps(rounded)}")

    modes = {
        "A scrub": sweep(scrub),
        "B clock": [pacmap_weights(k) for k in range(N_ITERS)],
        "C log curve": sweep(lambda s: eased(C_KNOTS, s)),
        "D global-local": sweep(global_local),
        "E arc": sweep(arc),
        "F fitted": sweep(lambda s: eased(f_knots, s)),
    }
    print(f"{args.size} {args.dim}D, a steady slide over {N_ITERS} iterations, against PaCMAP's final layout:")
    print(f"{'mode':16s} {'disparity':>9s} {'knn':>6s}")
    for name, weights in modes.items():
        Y = replay(weights, pairs, init)
        print(f"{name:16s} {disparity(Y, final):9.4f} {knn_overlap(Y, final):6.3f}", flush=True)


if __name__ == "__main__":
    main()
