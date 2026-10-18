# v2.0 — Playable PaCMAP

PaCMAP's optimisation, running live in the browser on 20,000 MNIST digits, with its
forces in your hands. PaCMAP samples three sets of pairs once (neighbours, mid-near
pairs and far pairs) and then pulls and pushes on them with weights that follow a fixed
450-iteration schedule. Here the pairs are fixed and the weights are yours: play each
force from on-screen sliders or a MIDI controller, attracting or repelling, against a
graph of PaCMAP's own schedule.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v2-0/web/public/data/)
cd ../pipeline
uv run v2-0.py               # defaults: -n 20000 --seed 0
uv run v2-0.py --check       # replays the exports against PaCMAP's own run

# 2. View
cd ../v2-0/web
pnpm install
pnpm dev
```

## Playing it

- **Forces.** One bipolar slider each for neighbours, mid-near and far pairs: up
  attracts, down repels, the grey band at centre is no force. The scale is logarithmic,
  from ±0.1 to ±2000 (range adjustable under the sliders), so one slider reaches both
  PaCMAP's 1–3 and its 1000; PaCMAP's values are marked on each track. Tick **spring** to
  make a slider return to 0 when let go. Arrow keys nudge a focused slider (shift for
  bigger steps), 0 zeroes it, double-click zeroes it too.
- **Loop.** Nothing runs until a force is non-zero. Then a playhead steps through
  PaCMAP's 450-iteration schedule at the chosen rate (1–60 it/s; about 30 is the most this
  machine manages) and wraps, with the layout carrying on. **smooth** glides between
  steps at 30 fps. Reset returns to the initial layout (staying paused if paused).
- **Autopilot** plays PaCMAP's own schedule once and stops. Grabbing a slider, pressing
  Manual or moving a MIDI control takes over from autopilot's current forces.
- **Schedule graph.** PaCMAP's three weights over one loop (dashed; far pairs below zero,
  as they repel), on the sliders' scale, with what you've played this loop drawn solid
  over them.
- **Optimiser.** PaCMAP's Adam by default. Adam steps at a near-fixed size, so it
  responds to the forces' ratios and signs but barely to their strength. **Adam + kick**
  forgets its state whenever a control moves; **short memory** adapts quickly (smaller
  beta2); **momentum descent** moves points in proportion to the force on them, with
  each step capped. **speed (lr)** is remembered per optimiser.

## MIDI (e.g. midi-surf)

Chrome, Edge or Firefox (not Safari). Press **Connect MIDI**, then **learn** beside a
force (or speed) and move the control to bind it.

- **Pitch bend** springs back to centre, so its force stops the moment you let go.
- **A fader** (any CC) stays where it's left, so its force carries on.

Both read centre as 0. Each control drives one target; learning it for another moves it.
Bindings and the chosen device are remembered, and MIDI reconnects on reload.

## How it works

- `pipeline/v2-0.py` runs PaCMAP once (`save_pairs=True`) and exports its pairs
  (`pairs_{nb,mn,fp}.bin`, uint32 i/j), its initial layout (`init.bin`), its layout every
  10 iterations as a reference (`reference.bin`) and the schedule and Adam constants
  (`meta.json`).
- `src/engine.ts` steps PaCMAP's gradient on those pairs with live signed weights. All
  three pair types share the kernel `2A / (A + dd)²` (A = 10, 10000 and 1), with the sign
  moved into the multiplier, so PaCMAP itself is (+w_nb, +w_mn, −w_fp). About 12–15 ms
  per iteration at 20k points, on the main thread.
- `pnpm run check:engine` checks the engine against PaCMAP's reference run (p99 error
  3e-6 of the layout through phase 1; `ITERS=450` checks the rest at a looser bar, as
  phase 2's rearrangement amplifies float rounding into a slightly rotated copy).
  `check:scale` and `check:midi` cover the control scale and MIDI decoding.
