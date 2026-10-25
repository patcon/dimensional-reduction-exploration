# v2.1 — Playable PaCMAP (mobile)

Building a mobile version of [v2.0](../v2-0/), to play PaCMAP's forces from a phone.

PaCMAP's optimisation, running live in the browser on 10k, 20k or all 65k MNIST digits, with its
forces in your hands. PaCMAP samples three sets of pairs once (neighbours, mid-near
pairs and far pairs) and then pulls and pushes on them with weights that follow a fixed
450-iteration schedule. Here the pairs are fixed and the weights are yours: play each
force from on-screen sliders or a MIDI controller, attracting or repelling, against a
graph of PaCMAP's own schedule, in 2D or 3D.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v2-1/web/public/data/)
cd ../pipeline
uv run v2-1.py               # defaults: -n 10000 20000 65000 --seed 0 (a few minutes)
uv run v2-1.py --check       # replays the exports against PaCMAP's own run

# 2. View
cd ../v2-1/web
pnpm install
pnpm dev
```

## Playing it

- **Layout.** The plot fills the screen. A drawer along the bottom always shows the transport (play,
  reset, and the schedule's three phases filling as the loop plays); open it (the chevron, or drag its
  handle) for the settings, in tabs along its bottom: **Forces**, **Play** (rate, smoothing, keeping
  the screen awake, the schedule graph), **View** (2D/3D, digits, auto-rotate), **Optimiser** and
  **MIDI**. The plot stays full-screen behind it, its centre sliding up into the space left. On the
  drawer's top edge, ⓘ opens the intro (and resets settings) and the cube or square switches 2D/3D.
  Every setting is remembered in the browser; what's played (the forces, autopilot) isn't.
- **Forces.** One bipolar slider each for neighbours, mid-near and far pairs: up
  attracts, down repels, the grey band at centre is no force. The scale is logarithmic,
  from ±0.1 to ±2000 (each slider's range adjustable behind the ⚙ under it), so one slider reaches both
  PaCMAP's 1–3 and its 1000; turn off **logarithmic** (behind the ⚙) for even steps of force instead (best
  with a smaller max). PaCMAP's values are marked on each track. Turn on **spring** to
  make a slider return to 0 when let go. Turn off **split** to draw a slider like a fader
  that starts at the bottom: the track sets the strength alone and a button beside it
  flips attract/repel. Both follow your MIDI setup when it changes (pitch bend turns on
  spring; a control with 0 at the bottom turns off split). Arrow keys nudge a focused slider (shift for
  bigger steps), 0 zeroes it, double-click zeroes it too.
- **Digits.** 10k, 20k or all 65k (in the view tab), each its own
  random sample with its own pairs. Switching starts over once the new digits have
  loaded; forces, optimiser and MIDI carry across. 65k steps about 4x slower than 20k.
- **Starting.** It opens in 3D on autopilot, paused: press play to watch
  PaCMAP's own run, or set the forces yourself first (grabbing a slider switches to Manual)
  and then start it.
- **Loop.** In Manual, nothing runs until a force is non-zero. Then a playhead steps through
  PaCMAP's 450-iteration schedule at the chosen rate (1–60 it/s; at 20k about 30 is the
  most this machine manages, at 65k about 13) and wraps, with the layout carrying on. **smooth** glides between
  steps at 30 fps. Reset returns to the initial layout and stops there until you start it again.
- **2D / 3D.** The same pairs laid out in two or three dimensions; switching starts over
  from that dimension's initial layout (PaCMAP's first two or three principal components).
  In 3D, drag the plot to turn it, or turn on **auto-rotate** to spin it. Nearer points are
  drawn over farther ones, which fade.
- **Pan and zoom.** The wheel, a trackpad pinch or a two-finger pinch zooms about the
  cursor; dragging pans (in 3D, shift- or right-drag, or two fingers). Both hold as the
  layout grows, since they sit on top of the auto-fit. Double-click or **Reset view** to
  go back.
- **Digits shown.** The bar in the plot's top left, one toggle per digit underlined in its colour, shows or
  hides that digit's points (the layout stays fitted to them all, so it doesn't jump); **\*** shows them all,
  and once all are shown, **∅** hides them all, to pick a few afresh. Hidden digits can't be picked.
- **Picking digits.** Click a digit to select it, ringed, and see it in the plot's top right corner; click
  away from any to select none. The mouse previews whichever digit it's over. Hold a press (or a finger)
  still for a moment to preview digits picked at random around it, inside a ring that follows it, as if
  tapping all round it; let go to return to the selected one.
  The selected digit's pairs are drawn as edges to it, in its forces' colours: neighbours, mid-near
  and far pairs (whichever end of the pair it's at). An edge is solid while its force attracts, dashed
  while it repels, and left out while it's at no force.
- **Autopilot** plays PaCMAP's own schedule once and stops. Grabbing a slider, pressing
  Manual or moving a MIDI control takes over from autopilot's current forces.
- **Schedule graph.** PaCMAP's three weights over one loop (dashed; far pairs below zero,
  as they repel), on a scale spanning the sliders' ranges, with what you've played this loop drawn solid
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

- `pipeline/v2-1.py`, for each sample size, runs PaCMAP in 2D and in 3D
  (`save_pairs=True`) and exports to `web/public/data/<size>/` (e.g. `20k/`) their shared
  pairs (`pairs_{nb,mn,fp}.bin`, uint32 i/j), each run's initial layout
  (`init_{2,3}d.bin`), the schedule and Adam constants (`meta.json`), and the digits' pixels, gzipped
  (`digits.bin.gz`, fetched after the rest, for previewing them). Each run's
  layout every 10 iterations goes to `pipeline/data/v2-1/<size>/reference_{2,3}d.bin`,
  kept out of the site, as a reference for the checks. The pairs are sampled from the
  PCA'd data alone, so both runs draw the same ones.
- `src/engine.ts` steps PaCMAP's gradient on those pairs with live signed weights. All
  three pair types share the kernel `2A / (A + dd)²` (A = 10, 10000 and 1), with the sign
  moved into the multiplier, so PaCMAP itself is (+w_nb, +w_mn, −w_fp). On the main
  thread, an iteration takes about 7, 16 and 64 ms at 10k, 20k and 65k points in 2D, and
  about a sixth longer in 3D.
- `pnpm run check:engine` checks the engine against PaCMAP's reference run (p99 error
  3e-6 of the layout through phase 1; `ITERS=450` checks the rest at a looser bar, as
  phase 2's rearrangement amplifies float rounding into a slightly rotated copy; `DIM=3`
  checks the 3D run, `SIZE=10k` or `SIZE=65k` another sample size).
  `check:scale` and `check:midi` cover the control scale and MIDI decoding.
