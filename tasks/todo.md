# v2.0 — Playable PaCMAP: tasks

See `tasks/plan.md` for the reference formulas, design decisions and risks.

## Task 1: Pipeline exports 20k subsample, pairs, init and PaCMAP reference

**Description:** `pipeline/v2-0.py` does three things:
- Subsamples 20k MNIST digits, reusing `fetch`/`load_mnist` from the v1 scripts.
- Runs `pacmap.PaCMAP(random_state=…, intermediate=True, intermediate_snapshots=[0,10,…,450]).fit(X, save_pairs=True)`.
- Exports everything the browser needs to rerun the optimisation, plus the reference
  result to check against.

**Acceptance criteria:**
- [x] `v2-0/web/public/data/` gets the following:
  - `pairs_nb.bin`, `pairs_mn.bin` and `pairs_fp.bin` (uint32 i,j pairs; 200k / 100k / 400k rows)
  - `init.bin` (float32 N×2, the snapshot at iteration 0)
  - `reference.bin` (float32 snapshots×N×2)
  - `meta.json` (N, labels, pair counts, snapshot iterations, the schedule constants and the Adam params)
- [x] `-n` defaults to 20000, and the run is deterministic for a given seed.
- [x] A `--check` mode replays the first 100 iterations from the exported files, in two ways:
  - With PaCMAP's own numba kernels, it matches `reference.bin` **exactly**, which proves the
    exports are complete.
  - With an independent numpy reimplementation, the p99 per-point error is 5e-6 of the layout
    spread. The max error is about 1e-2: Adam's `m/√v` amplifies summation-order rounding for
    the few points with near-zero gradient. **Task 2's JS engine check should use the same
    p99 metric, not the max.**

**Verification:**
- [x] `cd pipeline && uv run v2-0.py && uv run v2-0.py --check`
- [x] Manual: file sizes are as expected (about 5.6 MB of pairs and 160 KB of init)

**Dependencies:** None
**Files likely touched:** `pipeline/v2-0.py`, `v2-0/web/.gitignore`
**Estimated scope:** S

## Task 2: v2.0 app scaffold, with the engine running autopilot to a PaCMAP-like layout

**Description:** Copy `v1-2/web` tooling (Vite, React, TS, oxlint, pnpm) into `v2-0/web`
and drop the v1 components. Add three pieces:
- A data loader for Task 1's files.
- A pure `engine.ts`: typed-array signed-kernel gradient and Adam, `reset()`,
  `step(weights: {nb, mn, fp}, iter)`.
- A Canvas2D scatter coloured by digit label.

For now, an "Autopilot" button runs the PaCMAP schedule (with FP → negative multiplier)
through all 450 iterations.

**Acceptance criteria:**
- [x] Autopilot produces a layout visually matching the PaCMAP reference (10 separated digit clusters).
- [x] The engine is numerically checked. `pnpm run check:engine` steps from `init.bin` and
  matches `reference.bin` at iterations 10–100 with a p99 per-point error of 3e-6 of the
  layout spread (tolerance 1e-4).
  - `ITERS=450` also checks phases 2–3 at a looser 1e-2. Phase 2's rearrangement magnifies
    rounding into a slightly rotated or scaled copy of the same layout. The p99 error peaks at
    4e-3 at iteration 200, matching numpy's independent replay, so it isn't an engine bug.
- [x] One iteration at N=20k takes ≤ 30 ms on this machine (logged): about 12–15 ms.

**Verification:**
- [x] `pnpm run build` and `pnpm run lint` pass; the engine check script passes
- [x] Manual: `pnpm dev`, press Autopilot, and see clusters form. Headless Chrome reached
  450 with no errors and all 10 digit colours drawn; still needs a human eyeball.

**Dependencies:** Task 1
**Files likely touched:** `v2-0/web/{package.json,vite.config.ts,index.html}`, `src/{engine.ts,schedule.ts,useData.ts,App.tsx}`, `src/components/Scatter.tsx`, `scripts/check-engine.ts`
**Estimated scope:** M

## Checkpoint: Foundation
- [ ] Engine matches the Python reference; the app builds and lints
- [ ] Review with human: does autopilot look right before we hand over the forces?

## Task 3: Loop clock (slow rate, wrap and carry on, idle until a force acts)

**Description:** A `useLoopClock` that advances the playhead at a chosen rate (a 1–60 it/s
control, default 10) and steps the engine once per tick.
- At 450 the playhead wraps to 0, but the layout and Adam state carry on. Adam's bias
  correction uses a separate total-step counter.
- It stays idle at iteration 0, showing "move a control to start", until any force is
  non-zero (outside the deadzone). After that it keeps ticking even if forces return to 0.
- A manual reset returns the layout, Adam state and clock to init and idle.
- Autopilot becomes a mode of this clock rather than a one-shot run, and it starts the clock
  itself (its weights are non-zero).

**Acceptance criteria:**
- [x] The clock does not tick while every force is 0; it starts on the first non-zero force.
- [x] Wrapping at 450 keeps the layout; reset returns to init and idle.
- [x] Rate changes apply immediately; pause/resume works. The playhead, total steps and
  phase label (1/2/3) are shown.

**Verification:**
- [x] Build and lint pass
- [x] Manual, headless: autopilot starts the clock, the playhead wraps (465 steps total at
  iteration 15), pause holds and reset returns to idle. The deadzone part is checked in Task 4,
  once there are controls.
- **Found:** 60 it/s actually delivers about 32 it/s (15 ms per step plus redraw, on the main
  thread). Revisit at the Playable checkpoint, e.g. by moving the engine to a Web Worker.

**Dependencies:** Task 2
**Files likely touched:** `src/useLoopClock.ts`, `src/App.tsx`, `src/components/Transport.tsx`
**Estimated scope:** S

## Task 4: Symlog force controls on screen (spring/latch), wired into the engine

**Description:**
- `forceScale.ts` maps the bipolar symlog scale (`u ∈ [−1,1]` ↔ multiplier, with a deadzone
  and adjustable `m_min`/`m_max`) both ways.
- Three vertical bipolar sliders (NB, MN, FP), each with a spring/latch toggle and a readout
  of the multiplier, are wired to the engine when autopilot is off.
- An input store holds `u` per force, written to by any source. The clock watches it for
  the first non-zero multiplier.

**Acceptance criteria:**
- [x] Round-trip: `toU(toMultiplier(u)) ≈ u`; 0 inside the deadzone; PaCMAP's values (1, 2, 3, 1000) reachable.
- [x] A spring slider returns to 0 on pointer release (forces stop); a latch slider holds.
- [x] Flipping NB negative visibly explodes clusters; FP positive collapses the layout.
  From a converged layout:
  - NB −1 pushes the neighbour distance from 0.99 to 38 in 50 steps.
  - FP +1 shrinks the spread from 13.7 to 0.2 in 300 steps.

**Verification:**
- [x] Build and lint pass; `pnpm run check:scale` covers the round-trip, the deadzone and PaCMAP's values
- [ ] Manual (human): approximate phase 3 by hand (NB ≈ +1, FP ≈ −1) and see clusters
  tighten. Note whether Adam feels numb. Headless checks covered the deadzone start, spring vs
  latch, and taking over from autopilot.
- **Found:**
  - FP +1000 collapses at the same pace as FP +1 (spread 0.10 vs 0.20 after 300 steps): Adam
    ignores magnitude.
  - Wiping Adam's m/v doesn't speed things up either (Adam's step is about lr per step).
  - So the kick alone won't make magnitudes matter; momentum descent (Task 5) should.
- **Added beyond the plan:** under autopilot the sliders mirror PaCMAP's forces, and grabbing
  one switches to manual from exactly those values.

**Dependencies:** Task 3
**Files likely touched:** `src/forceScale.ts`, `src/inputStore.ts`, `src/components/ForceSliders.tsx`, `src/engine.ts`, `src/App.tsx`
**Estimated scope:** M

## Task 5: Switchable optimisers and a master speed control

**Description:** Split the optimiser out of `engine.ts` into `optimisers.ts`. The engine
computes the gradient and the optimiser turns it into a step. Each optimiser has
`reset()` and `step(Y, grad, totalStep, speed)`, plus an optional `onControlChange()` hook.
A dropdown switches between them live:
1. **PaCMAP Adam** (default): β1=0.9, β2=0.999, ε=1e-7, lr=1, bias-corrected. It's the
   only one autopilot is checked against.
2. **Adam + kick**: like PaCMAP Adam, but `v` (and the bias-correction count) is
   reset whenever an input moves past a small threshold. The input store calls `onControlChange()`.
3. **Adam, short memory**: β2 about 0.9, with β2 adjustable in the panel.
4. **Momentum descent**: `vel = μ·vel − lr·grad; Y += vel`. Each point's step is capped at
   a maximum length, and μ, lr and the cap are adjustable in the panel.

A **master speed** control scales every optimiser's lr; at 1× it leaves PaCMAP's lr unchanged.
It can be bound to a fourth MIDI control in Task 7. Switching optimiser keeps the layout but
resets the optimiser's internal state.

**Acceptance criteria:**
- [x] All four are selectable while running; PaCMAP Adam is the default, and the Task 2
  engine check still passes with it.
- [x] Momentum descent never produces a jump longer than the step cap, even with MN at 2000.
  With every force at ±2000, the longest single-point step is exactly 1.0 (the cap).
- [x] Master speed changes motion in every optimiser, including Adam (it scales each one's lr).

**Verification:**
- [x] Build and lint pass; the engine check script passes
- [x] Burst test in Node, from a converged layout: phase-3 forces with MN +1000 for 30 steps,
  then MN 0. Mean movement over the 10 steps after the drop:

  | Optimiser | Movement |
  |---|---|
  | Adam | 2.2 (lags) |
  | Adam + kick | 3.9 |
  | Adam, short memory | 3.6 |
  | Momentum | 5.7 (part of it coasting) |

- [ ] Manual (human): feel the difference while playing.
- **Momentum defaults:** lr 1, coast 0.9, cap 1. Run on PaCMAP's schedule they score 0.917 on
  2-D 10-NN label agreement vs PaCMAP's 0.925; lr 10 or more scrambles it (about 0.75).

**Dependencies:** Task 4
**Files likely touched:** `src/optimisers.ts`, `src/engine.ts`, `src/inputStore.ts`, `src/components/OptimiserPanel.tsx`, `src/App.tsx`
**Estimated scope:** M

## Task 6: Schedule graph with PaCMAP's curves, playhead and your settings

**Description:** An SVG graph:
- x is iteration 0–449; y uses the symlog scale from `forceScale.ts`, with 0 in the middle
  and repulsion below.
- It shows PaCMAP's three reference curves (NB, MN and −FP), with phase boundaries at 100 and
  200 and a playhead.
- It also shows your current multipliers as dots at the playhead and a trail of your values
  across the current loop (cleared on wrap).
- Colours are consistent per force across the graph and sliders.

**Acceptance criteria:**
- [x] The reference curves match `find_weight` (MN 1000 → 3 over phase 1, and so on).
- [x] Your trail lines up exactly with the slider positions (same scale).
  At NB +4.10, the trail's last point and the live dot are both at y 60.4.
- [x] In autopilot, your trail lies on the reference curves (identical points).

**Verification:**
- [x] Build and lint pass
- [x] Manual, headless: the autopilot trail overlays the reference, the manual trail follows
  the slider, and the trail clears on wrap.
- [ ] Manual (human): does the graph help in approximating the schedule by hand?

**Dependencies:** Task 4
**Files likely touched:** `src/components/ScheduleGraph.tsx`, `src/schedule.ts`, `src/App.tsx`
**Estimated scope:** S–M

## Checkpoint: Playable
- [ ] A full loop can be played with mouse only; the graph and sliders agree
- [ ] Review with human: rate, range, deadzone and optimiser feel

## After the Playable review (2026-10-18)
- [x] Reset while paused stays paused; Resume restarts from the initial layout.
- [x] "smooth" toggle (on by default): the layout redraws at 30 fps, gliding from the layout
  before each step to the one after it (one step behind). Off: it redraws once per step,
  capped at 30 fps. Headless at 5 it/s: about 28 draws/s on, 5 off, 0 when paused.
- [x] Momentum descent defaults are now coast 0.5, step cap 1 and speed 0.15×. Speed is
  remembered per optimiser (Adam variants default to 1×); double-clicking the speed slider
  restores the current optimiser's default.

## Task 7: Web MIDI input (device picker, MIDI-learn, pitch bend and CC)

**Description:** `midi.ts`, using `navigator.requestMIDIAccess`:
- A device picker and a per-force "learn" button that binds the next pitch-bend (channel n)
  or CC (channel, number) message.
- Pitch bend is 14-bit; centre 8192 → u=0, and it springs back on release.
- CC is 7-bit; centre 64 → u=0, and it latches.
- Messages write into the input store.
- Bindings persist in localStorage (wrapped in try/catch).
- A note is shown when Web MIDI is unavailable.

**Acceptance criteria:**
- [ ] A force can be bound to pitch bend; releasing it zeroes that force.
- [ ] A force can be bound to a CC fader; the value holds after letting go.
- [ ] Master speed (Task 5) can be bound to a fourth control.
- [ ] The first non-zero MIDI value starts the loop; on-screen sliders mirror the MIDI-driven values.

**Verification:**
- [ ] Build and lint pass; a unit check decodes pitch-bend and CC bytes to `u`
- [ ] Manual with midi-surf: bind all three, play a loop, and reload to confirm bindings persist

**Dependencies:** Task 4 (Task 6 not required)
**Files likely touched:** `src/midi.ts`, `src/components/MidiPanel.tsx`, `src/inputStore.ts`, `src/App.tsx`
**Estimated scope:** M

## Task 8: Deploy (CI matrix, landing page card, READMEs)

**Description:**
- Add `v2-0` to the Pages workflow matrix. The pipeline step runs `uv run v2-0.py`; the
  PaCMAP fit at 20k takes about 10s.
- Add a v2.0 card to `site/index.html`.
- Write `v2-0/README.md` (run instructions, controls, the MIDI setup for midi-surf) and add
  a line to the root README.

**Acceptance criteria:**
- [ ] CI builds v2-0 alongside v1-x; the app works under `/v2-0/` (base path respected in data fetches).
- [ ] The landing page links to v2.0.

**Verification:**
- [ ] `pnpm run build --base /x/v2-0/` then `pnpm preview` loads data
- [ ] Manual: the deployed page loads after merge

**Dependencies:** Task 2 (best done after Task 7)
**Files likely touched:** `.github/workflows/pages.yml`, `site/index.html`, `README.md`, `v2-0/README.md`
**Estimated scope:** S

## Checkpoint: Complete
- [ ] All acceptance criteria met; played end to end with midi-surf
- [ ] Ready for review
