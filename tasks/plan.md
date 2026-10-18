# Implementation Plan: v2.0 — Playable PaCMAP

## Overview

A prototype that runs PaCMAP's optimisation loop live in the browser on 20k MNIST digits.
You "play" the forces by hand. Python precomputes everything that doesn't depend on the
forces: the subsample, the three pair sets (neighbour, mid-near, far) and the initial
layout. The browser runs the gradient and Adam steps slowly, on a loop over PaCMAP's
450-iteration schedule. Three signed force multipliers drive it: positive attracts and
negative repels. MIDI (pitch bend or faders, via midi-surf) or on-screen controls set them.
A schedule graph plots PaCMAP's own weights over the loop, and your live settings over
them, so you can try to reproduce the schedule by hand.

Lives at `v2-0/` (app in `v2-0/web`) with data from `pipeline/v2-0.py`, matching the v1.x layout.

## Reference: what PaCMAP actually does

Read from the installed `pacmap` package (`pipeline/.venv/.../pacmap/pacmap.py`). The
same figures appear in patcon/pacmap-webgpu. For each pair (i, j), with `dd = 1 + |yi − yj|²`:

| Pair type | Per point (N=20k) | Loss | Gradient coefficient `c` (grad_i += c·(yi−yj)) |
|---|---|---|---|
| neighbour (NB) | 10 | `w·dd/(10+dd)` | `+w·20/(10+dd)²` |
| mid-near (MN) | 5 | `w·dd/(10000+dd)` | `+w·20000/(10000+dd)²` |
| far (FP) | 20 | `w/(1+dd)` | `−w·2/(1+dd)²` |

Schedule (`find_weight`, phases 100/100/250 = 450 iterations):

| Iterations | w_NB | w_MN | w_FP |
|---|---|---|---|
| 0–99 | 2 | 1000 → 3 (linear) | 1 |
| 100–199 | 3 | 3 | 1 |
| 200–449 | 1 | 0 | 1 |

Optimiser: Adam with lr=1.0, β1=0.9, β2=0.999 and ε=1e-7, using bias correction on the
iteration count. Init: `0.01 ×` the 2-D PCA of the 100-d TruncatedSVD-preprocessed data.

## Architecture Decisions

- **Signed multipliers, sign pulled out of the kernels.** Each pair type keeps its own
  kernel *shape*, but every kernel is written as an attraction: `c = m · k(dd)`, with
  `k_FP = 2/(1+dd)²`. Your multiplier `m` carries the sign, so PaCMAP corresponds to
  `m_NB = +w_NB`, `m_MN = +w_MN` and `m_FP = −w_FP`. The schedule graph plots FP as a
  negative line, and any pair type can be flipped.
- **Pairs are fixed and forces are live.** Pairs are sampled once in Python, from
  PaCMAP's own `fit(save_pairs=True)`, so they are exactly the pairs PaCMAP used. The same
  run also exports a reference embedding and snapshots, which let us check the JS engine.
- **CPU TypeScript engine first, not WebGPU.** 20k points × 35 pairs is about 700k pair
  updates per iteration, roughly 10–20 ms in typed-array JS. You want to run slowly anyway. The
  engine stays a pure module (`step(weights)`) behind a small interface, so pacmap-webgpu's
  `grad_main`/`adam_main` WGSL could replace it later. Its `docs/ideas/freeform-forces.md`
  plans the same feature on GPU and is worth rereading if we switch.
- **Bipolar symlog control scale.** A control value `u ∈ [−1, 1]` maps to
  `m = sign(u) · m_min · (m_max/m_min)^((|u|−dz)/(1−dz))` when `|u| > dz`, and to 0 inside
  the deadzone. Defaults are `m_min = 0.1`, `m_max = 2000` and `dz = 0.04`, which covers
  PaCMAP's 1, 2, 3 and 1000. The same mapping serves MIDI and on-screen controls, and the
  graph's y-axis uses it too, so a slider position and a graph height mean the same thing.
- **One normalised input model for every source.** Each source produces `u ∈ [−1, 1]` per
  force:
  - Pitch bend (14-bit, centre 8192) springs back to 0, so forces stop on release.
  - A CC fader (7-bit, centre 64 = 0) latches, so forces continue.
  - On-screen sliders get the same two behaviours as a per-slider "spring / latch" toggle.
  - MIDI-learn binds a force to whichever message moves next.
- **Loop clock.** A playhead runs over iterations 0–449 at a chosen rate (default about
  10 it/s, adjustable from about 1 to 60). At the wrap, the layout and Adam state **carry
  on**; only the playhead and the graph's trail restart. Adam's bias correction counts total
  steps, not the playhead. A manual reset button returns to the init. The clock idles at
  iteration 0 ("move a control to start") until **the first non-zero force**. Touching a
  control inside the deadzone doesn't count. After that it keeps ticking, even if forces
  go back to 0. The playhead drives the schedule graph's cursor. It does **not** apply
  PaCMAP's weights unless autopilot is on.
- **Autopilot mode (for verification and as a reference).** A toggle that feeds the
  real schedule into the engine instead of your inputs. It shows whether the engine
  matches PaCMAP, and gives you something to compare your manual run against.
- **Stack and conventions** are copied from `v1-2/web`: Vite, React 19, TS, oxlint and
  pnpm. Data goes in gitignored `v2-0/web/public/data/`, built in CI by the pipeline.

## Task List

Detailed tasks with acceptance criteria are in `tasks/todo.md`.

### Phase 1: Foundation (high risk first)
- [x] Task 1: Pipeline exports 20k subsample, pairs, init and PaCMAP reference
- [x] Task 2: v2.0 app scaffold, with the engine running autopilot to a PaCMAP-like layout

### Checkpoint: Foundation
- [ ] JS engine autopilot output is close to the Python reference; app builds

### Phase 2: Playable without MIDI
- [x] Task 3: Loop clock (slow rate, wrap and carry on, idle until a force acts)
- [x] Task 4: Symlog force controls on screen (spring/latch), wired into the engine
- [x] Task 5: Switchable optimisers and a master speed control
- [x] Task 6: Schedule graph with PaCMAP's curves, playhead and your settings

### Checkpoint: Playable
- [ ] The full loop can be played by mouse; the graph matches the controls

### Phase 3: MIDI and ship
- [x] Task 7: Web MIDI input (device picker, MIDI-learn, pitch bend and CC)
- [ ] Task 8: Deploy (CI matrix, landing page card, READMEs)

### Checkpoint: Complete
- [ ] Played end to end with midi-surf; deployed under `/v2-0/`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Adam swallows the multipliers.** Adam normalises each coordinate's step by √v, so scaling all three forces together barely changes motion; only their *ratios* and signs matter. Late in a loop, `v` is large and controls can feel numb. pacmap-webgpu's design doc flags the same issue. | High | Task 5 adds four switchable optimisers (PaCMAP Adam, Adam + kick, short-memory Adam, capped momentum descent) and a master speed control. PaCMAP's Adam is the default so autopilot stays faithful. |
| Forces don't stop *instantly* on pitch-bend release: Adam momentum (β1=0.9) coasts for about 10 iterations. | Med | At slow rates this is under a second. If it feels wrong, zero `m` whenever all forces are 0. |
| The 7-bit CC fader resolution over about 4 decades is about 15% per step. | Low | Pitch bend is 14-bit. Range and deadzone are adjustable, and `m_min`/`m_max` can be narrowed per force. |
| Web MIDI works only in Chromium-based browsers and Firefox (with a permission prompt), not Safari. | Med | On-screen controls are a first-class path; show a note when `navigator.requestMIDIAccess` is missing. |
| Engine diverges from PaCMAP (sign or bias-correction mistakes). | Med | Task 2 compares against exported Python snapshots numerically before any UI work. |
| Drawing 20k points every frame in Canvas2D is slow. | Low | Draw only when the layout changes; move to a WebGL points layer if a frame takes more than about 8 ms. |

## Decisions (2026-10-18)

1. At loop wrap the layout keeps going; only the playhead and trail restart.
2. The clock starts at the first non-zero force, not the first touch.
3. Faders are bipolar, centre = 0, with a deadzone to make centre findable.
4. Named v2.0 (`v2-0/`).
5. All four optimisers are switchable, plus a master speed; PaCMAP's Adam is the default.
