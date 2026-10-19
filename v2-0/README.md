# v2.0 — Playable PaCMAP

PaCMAP's optimisation, running live in the browser on 20,000 MNIST digits, with its
forces in your hands. PaCMAP samples three sets of pairs once (neighbours, mid-near
pairs and far pairs) and then pulls and pushes on them with weights that follow a fixed
450-iteration schedule. Here the pairs are fixed and the weights are yours: play each
force from on-screen sliders or a MIDI controller, attracting or repelling, against a
graph of PaCMAP's own schedule, in 2D or 3D.

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
  make a slider return to 0 when let go. Untick **split** to draw a slider like a fader
  that starts at the bottom: the track sets the strength alone and a button beside it
  flips attract/repel. Both follow your MIDI setup when it changes (pitch bend ticks
  spring; a control with 0 at the bottom unticks split). Arrow keys nudge a focused slider (shift for
  bigger steps), 0 zeroes it, double-click zeroes it too.
- **Loop.** Nothing runs until a force is non-zero. Then a playhead steps through
  PaCMAP's 450-iteration schedule at the chosen rate (1–60 it/s; about 30 is the most this
  machine manages) and wraps, with the layout carrying on. **smooth** glides between
  steps at 30 fps. Reset returns to the initial layout (staying paused if paused).
- **2D / 3D.** The same pairs laid out in two or three dimensions; switching starts over
  from that dimension's initial layout (PaCMAP's first two or three principal components).
  In 3D, drag the plot to turn it (double-click to reset the view), or tick
  **auto-rotate** to spin it. Nearer points are drawn over farther ones, which fade.
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

Each force reads its control one of two ways (the **0 at** menu beside it):

- **Centre (±):** up attracts, down repels. **Pitch bend** springs back to centre, so its
  force stops the moment you let go; **a fader** (any CC) stays where it's left, so its
  force carries on.
- **Bottom, + sign switch:** the control sets only the strength, from no force at the
  bottom, and a second control (learn it as **sign**, e.g. a toggle button) flips the
  force between attract (top half) and repel (bottom half). It starts as PaCMAP does: far pairs repel, the others attract.

Each control drives one target; learning it for another moves it. Bindings, zero points
and the chosen device are remembered, and MIDI reconnects on reload.

### Don't have a MIDI device? Use your phone as one

The MIDI panel has three ready-made [MIDI Surf](https://github.com/patcon/midi-surf)
layouts, each with a QR code that opens it on the phone and a **Use this layout** button
that binds everything here to match:

| Layout | Controls | Bindings |
|---|---|---|
| PaCMAP 🎚️ | three faders parked half way, centre is 0 | CC 20–22, ch 1 |
| PaCMAP 🎚️± | three faders from 0, a 🧲± toggle under each | faders CC 23–25, toggles CC 26–28, ch 1 |
| PaCMAP 🎯 | three pitch-bend strips | pitch bend, ch 1–3 |

1. Plug an Android phone into the computer by USB. On the phone, tap the USB notification
   (or find USB under Settings → Connected devices) and choose **MIDI**; the computer then
   sees the phone as a USB MIDI device. Menu names vary by phone
   ([more on Android USB MIDI](https://midi.org/developing-midi-applications-on-android)).
2. Scan a layout's QR code with the phone and accept MIDI Surf's offer to import the page
   (or download its page file and use MIDI Surf's import), then press **Use this layout**.
3. In MIDI Surf, send to the USB port (usually "Android USB Peripheral").
4. Press **Connect MIDI** and move a control.

The layouts are written by `web/scripts/midi-surf-pages.py` (`uv run scripts/midi-surf-pages.py`
from `web/`) into `web/public/midi-surf/` and `web/src/midiSurfLinks.ts`; their CC numbers
must match `web/src/midiSurf.ts`.

**iPhone or iPad:** browsers on iOS don't support Web MIDI
([WebKit bug 107250](https://bugs.webkit.org/show_bug.cgi?id=107250)), so MIDI Surf
can't run there. Use a MIDI controller app from the App Store with a Mac instead: plug in
by USB, open Audio MIDI Setup, choose Window → Show Audio Devices and click Enable under
your device ([Apple's guide](https://support.apple.com/guide/audio-midi-setup/set-up-audio-devices-ams59f301fda/mac)),
or connect over Wi-Fi with a
[network MIDI session](https://support.apple.com/guide/audio-midi-setup/share-midi-information-over-a-network-ams1012/mac).

## How it works

- `pipeline/v2-0.py` runs PaCMAP in 2D and in 3D (`save_pairs=True`) and exports their
  shared pairs (`pairs_{nb,mn,fp}.bin`, uint32 i/j), each run's initial layout
  (`init_{2,3}d.bin`), its layout every 10 iterations as a reference
  (`reference_{2,3}d.bin`) and the schedule and Adam constants (`meta.json`). The pairs
  are sampled from the PCA'd data alone, so both runs draw the same ones.
- `src/engine.ts` steps PaCMAP's gradient on those pairs with live signed weights. All
  three pair types share the kernel `2A / (A + dd)²` (A = 10, 10000 and 1), with the sign
  moved into the multiplier, so PaCMAP itself is (+w_nb, +w_mn, −w_fp). About 12–15 ms
  per iteration at 20k points in 2D (about 20 ms in 3D), on the main thread.
- `pnpm run check:engine` checks the engine against PaCMAP's reference run (p99 error
  3e-6 of the layout through phase 1; `ITERS=450` checks the rest at a looser bar, as
  phase 2's rearrangement amplifies float rounding into a slightly rotated copy; `DIM=3`
  checks the 3D run).
  `check:scale` and `check:midi` cover the control scale and MIDI decoding.
