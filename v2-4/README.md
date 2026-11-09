# v2.4 — Asymmetric LocalMAP

[v2.3](../v2-3/) with each pair's force leaning toward one end, to see what the high-dimensional data does to a map
that would otherwise settle.

Every PaCMAP pair is one digit's choice: `(i, j)` is in `i`'s list (its neighbours are its nearest in the data). PaCMAP
pulls or pushes both ends equally, which makes the whole thing the gradient of one loss, so it can only settle. A
**lean** (−1 to 1, per force) gives `i`, the chooser, `1 + lean` of the force and `j`, the chosen, `1 − lean`: same
sign, same total. Two things follow:

- Where a pair is listed both ways round (mutual neighbours) the leans cancel exactly. Only one-way relationships
  move differently: 18% of neighbour pairs at 10k.
- Each one-way pair then pushes both its digits on together, from chooser toward chosen (or back, leaning the other
  way). Where those pushes add up, the map keeps moving: nothing in it is a potential any more.

Unequal forces could add up to a net force on the whole map, carrying it off as one; the engine takes that off every
point equally, so only relative motion is left (with no lean there's none to take off).

**Scramble who chose whom** is the null: each one-way neighbour pair turned round, or not, at random. The same digits
pair and the same pairs are mutual; only the data's say in which chose which is gone. Mid-near and far pairs aren't
scrambled, as each is already drawn at random by its chooser.

### Defaults, and why

Autopilot plays LocalMAP's run and then **holds its last phase** (neighbours 1, far pairs −1, boosted, redrawn every
10), as PaCMAP does given more iterations, so the map has time to move once formed.

The lean opens at **neighbours +1**, the others even. A pair is its chooser's view of the data, so the chooser is the
one to react to it: each digit is pulled toward the digits it counts as neighbours, and isn't pulled by being counted.
Where that's one-way, the pair moves on together from chooser toward chosen. `pnpm run explore:lean`
(scripts/explore-lean.ts) plays LocalMAP's run at 10k, holds it 1200 steps with each lean, and measures how far points
travel over the last 100 (as a share of the map's spread) against the same lean scrambled:

| lean (3D, Adam) | drift ×1000 | scrambled | 10-NN same digit |
|---|---|---|---|
| none | 8 | — | 0.92 |
| neighbours +1 (chooser) | 261 | 191 | 0.90 |
| neighbours −1 (chosen) | 576 | 179 | 0.78 |
| all +1 (chooser) | 560 | 515 | 0.78 |

Unleaned, the map is still; leaned toward the chooser it keeps moving and stays a map, the data's own who-chose-whom
moving it more than scrambled. Leaning toward the chosen moves it most, and most unlike its null, but reads backward
(a digit reacting to being seen) and pulls the map apart. Leaning the mid-near and far pairs too, as a chooser's whole
view, moves the map as much scrambled: each is a random draw, so that motion is the draw's noise, not the data's, and
they open even. Leaning from the first step still forms the map (0.92 at 450).

**The view.** v2.3 fitted the plot to the layout's bounding box every frame, so on a moving map one wandering digit
moved the whole view. Here it centres on the centroid and reaches as far as 98% of the digits, easing there over about
half a second (`src/fit.ts`): on a held, leaning 10k map in 3D, the centre shifts 0.002% of the view per step against
1.1% before, and its size 0.2% against 1.4%. **Follow the selected digit** (view tab) keeps a digit at the middle
instead, the map moving past it.
The palette button at the end of the digit bar switches points between their digit's colour and one plain grey (the
bar's underlines stay, as a legend), to watch the motion without the labels; it's remembered. Zoom goes out to a tenth
of the fit (half before), so the whole map can be seen with the drawer open and the farthest digits beyond the fit.

**The resample brush** (🖌, on the plot's bottom edge beside ⓘ) redraws far pairs where you paint, and nowhere else.
On, a dashed ring the threshold across (at the map's middle depth) follows the pointer or finger; pressing and dragging
paints instead of turning or panning (a two-finger pinch still zooms), redrawing the far pairs of the shown digits
under it, from those within the threshold of each, every 120 ms while held, the map moving under a still brush
included. In 3D a digit is under it if it's drawn inside the ring at its own depth's scale. Painting takes over from
autopilot, as touching a force does, and turns off auto-resampling, so from then on only brushed digits are redrawn;
restore global puts every digit's back. The far-pair readout says how many digits were brushed.

**+** beside the brush switches it from resampling to **upsampling**: painting adds far pairs to the digits under it,
keeping those they have, one per digit per paint (so holding the brush longer adds more). Each is drawn as a redraw
is, from those within the threshold, and is never the digit itself, a neighbour or a far partner it has already. Added
pairs are kept apart from the sampled ones (the engine assumes each digit has the same number of those), feel the far
pairs' force and lean, and outlast resampling; restore global and reset drop them. The brush icon wears a + while
upsampling, the choice is remembered, and the readout counts what's been added in all.

What follows is v2.3's.

## v2.3 — Playable LocalMAP

[v2.1](../v2-1/) with [LocalMAP](https://github.com/YingfanWang/PaCMAP)'s additions to play: far pairs redrawn from
the digits near each one on the map, on LocalMAP's schedule, every so many steps, or at the press of a button (on screen
or MIDI), and put back to PaCMAP's global ones; and LocalMAP's boost to close neighbours, switched on or off.

LocalMAP ([Wang et al., AAAI 2025](https://doi.org/10.1609/aaai.v39i20.35436)) is PaCMAP with two changes in its last
phase. Every 10 iterations from 210 it redraws each digit's far pairs from the digits within a threshold of it on the
map (10, in layout units) that aren't its neighbours, so far pairs push apart clusters that touch rather than ones
already apart. And from 201 it scales each neighbour pair's pull by (threshold / 2) / √(1 + d²): five times as hard
where they touch.

PaCMAP's optimisation, running live in the browser on 10k, 20k or all 65k MNIST digits, with its
forces in your hands. PaCMAP samples three sets of pairs once (neighbours, mid-near
pairs and far pairs) and then pulls and pushes on them with weights that follow a fixed
450-iteration schedule. Here the pairs are fixed and the weights are yours: play each
force from on-screen sliders or a MIDI controller, attracting or repelling, against a
graph of PaCMAP's own schedule, in 2D or 3D.

```sh
# 1. Process data (downloads MNIST sprite on first run; writes v2-4/web/public/data/)
cd ../pipeline
uv run v2-4.py               # defaults: -n 10000 20000 65000 --seed 0 (a few minutes)
uv run v2-4.py --check       # replays the exports against PaCMAP's own run
uv run v2-4.py --check --algo localmap   # ... and LocalMAP's, to its first redraw

# 2. View
cd ../v2-4/web
pnpm install
pnpm dev
```

## Playing it

- **Layout.** The plot fills the screen. A drawer along the bottom always shows the transport (play,
  reset, and the schedule's three phases filling as the loop plays); open it (the chevron, or drag its
  handle) for the settings, in tabs along its bottom: **Forces**, **Local** (LocalMAP), **Play** (rate, smoothing, keeping
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
  LocalMAP's own run, or set the forces yourself first (grabbing a slider turns autopilot off)
  and then start it.
- **Loop.** Off autopilot, nothing runs until a force is non-zero. Then a playhead steps through
  PaCMAP's 450-iteration schedule at the chosen rate (1–60 it/s; at 20k about 30 is the
  most this machine manages, at 65k about 13) and wraps, with the layout carrying on. **smooth** glides between
  steps at 30 fps. Reset returns to the initial layout and stops there until you start it again.
- **Step back.** ⏮ beside reset goes back to the last checkpoint and pauses there, to try again from it; press
  it again to go further back. A checkpoint is taken every 25 iterations as the loop plays, and before each brush
  stroke, resample or restore by hand, 40 kept at most. It puts back the layout, the optimiser's state, the far pairs
  (redrawn and added ones too) and where their draws were up to, so playing on from it the same way does the same
  again. The forces, autopilot and settings stay as they are. Playing on from a checkpoint drops those after it, and
  reset drops them all.
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
- **Picking digits.** A digit picked at random is selected on opening (and on switching sample size), so its edges show from the start. Click a digit to select it, ringed, and see it in the plot's top right corner; click
  away from any to select none. The mouse previews whichever digit it's over. Hold a press (or a finger)
  still for a moment to preview digits picked at random around it, inside a ring that follows it, as if
  tapping all round it; let go to return to the selected one.
  The selected digit's pairs are drawn as edges to it, in its forces' colours: neighbours, mid-near
  and far pairs (whichever end of the pair it's at). An edge is solid while its force attracts, dashed
  while it repels, and left out while it's at no force.
- **Autopilot** (atop the forces tab: **LocalMAP**, **PaCMAP** or **manual**) plays LocalMAP's run or PaCMAP's
  once and stops. Choosing manual, grabbing a slider or the boost switch, or moving a MIDI control turns it off, taking
  over from autopilot's current forces and boost. The algorithm last chosen is remembered.
- **LocalMAP.** Above the far-pair slider, **resample** redraws every digit's far pairs from those within the
  threshold of it on the map (not itself, its neighbours, or a repeat), and says beneath it what share found one
  and at which step (in red under half: the threshold is likely small for how spread out the map is; the rest keep
  their partners). Above the neighbour slider, **boost** switches LocalMAP's pull on close neighbours. Both are greyed out there while autopilot plays PaCMAP, which has neither. The **local**
  tab has these too, with **restore global** (PaCMAP's far pairs, as sampled at the start), **resample every N
  steps** off autopilot, and the **threshold** (1–100, log; it also sets the boost, to half of it). With a digit
  selected, its far-pair edges jump to their new partners on a redraw, inside a dashed ring at the threshold (shown
  while the far pairs are local, or the local tab is open). Reset puts PaCMAP's far pairs back.
- **Schedule graph.** PaCMAP's three weights over one loop (dashed; far pairs below zero,
  as they repel), on a scale spanning the sliders' ranges, with what you've played this loop drawn solid
  over them. Ticks along its bottom, in the far pairs' colour, mark
  where far pairs are redrawn: LocalMAP's own (every 10 from 210) dashed, and yours this loop (autopilot's,
  auto-resampling's or a press of resample) solid.
- **Optimiser.** PaCMAP's Adam by default. Adam steps at a near-fixed size, so it
  responds to the forces' ratios and signs but barely to their strength. **Adam + kick**
  forgets its state whenever a control moves; **short memory** adapts quickly (smaller
  beta2); **momentum descent** moves points in proportion to the force on them, with
  each step capped. **speed (lr)** is remembered per optimiser.

## MIDI (e.g. midi-surf)

Chrome, Edge or Firefox (not Safari). Press **Connect MIDI**, then **learn** beside a
force (or speed) and move the control to bind it.

**Resample** can be learnt too: a button (or any control pushed past half way) redraws the far pairs.

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
| LocalMAP 🎚️ | three faders parked half way, centre is 0 | CC 20–22, ch 1 |
| LocalMAP 🎚️± | three faders from 0, a 🧲± toggle under each | faders CC 23–25, toggles CC 26–28, ch 1 |
| LocalMAP 🎯 | three pitch-bend strips | pitch bend, ch 1–3 |

Each has a 🔀 resample button above the far-pair control, sending CC 29 on channel 1.

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

- `pipeline/v2-4.py`, for each sample size, runs PaCMAP in 2D and in 3D
  (`save_pairs=True`) and exports to `web/public/data/<size>/` (e.g. `20k/`) their shared
  pairs (`pairs_{nb,mn,fp}.bin`, uint32 i/j), each run's initial layout
  (`init_{2,3}d.bin`), the schedule and Adam constants (`meta.json`), and the digits' pixels, gzipped
  (`digits.bin.gz`, fetched after the rest, for previewing them). Each run's
  layout every 10 iterations goes to `pipeline/data/v2-4/<size>/reference_{2,3}d.bin`,
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
  `check:scale` and `check:midi` cover the control scale and MIDI decoding (and the resample trigger).
- The pipeline also runs LocalMAP, from the same seed, keeping its run as `reference_localmap_{2,3}d.bin`, and asserts
  it samples the same pairs and matches PaCMAP's run up to phase 3. LocalMAP's redraw reads only the layout and the
  neighbour pairs, so the browser needs no more data for it. `ALGO=localmap pnpm run check:engine` follows LocalMAP's
  run through iteration 210, its boost included; the boosted snapshots get a looser bar, as the boost magnifies float
  drift (from one perturbation at 200, numba's own kernels end 10 iterations later 2x smaller under PaCMAP and 3x
  bigger under LocalMAP). Its redraws can't be replayed (numba draws random numbers per thread).
- `engine.resampleFar` draws from the grid cells around each digit, a threshold wide, rather than from every digit
  as PaCMAP's loop does: that loop doesn't count draws too far away against its 100 tries, so where few digits are
  near it can take seconds at 10k digits (minutes at 65k). Where the cells hold few digits it lists the ones it may
  pick and picks from the list. A redraw takes ~40 ms at 10k, ~100 ms at 20k and 0.2–0.5 s at 65k on a laptop.
  `pnpm run check:localmap` checks a redraw's rules on LocalMAP's layouts, compares it with a port of PaCMAP's
  sampler (as many redrawn, as far apart, as often the same digit), and plays a whole LocalMAP run: it lands nearer
  LocalMAP's layout than PaCMAP's does (10-NN shared 53% vs 28% at 10k in 2D, 65% vs 45% in 3D) and as pure.
  It also checks that a run played on from a checkpoint and then put back to it plays again bit for bit, redraws,
  brushing and upsampling included.
