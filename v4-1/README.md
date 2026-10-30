# v4.1 — MNIST valence music

A fresh copy of [v4.0](../v4-0/) to build on, to add music: a random walk through the digits'
nearest neighbours over the window, as the playhead reads.

v4.0 was built on [v3.3](../v3-3/), with live participants among the digits. People open the site's front
page on their phones and "pretend to be" a digit: tilting the phone draws one as the playhead reads
along, and they watch their cursor get grouped with the MNIST digits it looks like. If they switch to
drawing a different digit, their cursor moves to a different group.

It's a Cloudflare Worker (`mnist-valence-music`) with a Durable Object room, so unlike the
other versions it isn't on GitHub Pages.

- **`/`, the participant remote.** The phone is a pen, turned one way for ink (+1) and the other for
  paper (−1), as the room's valence detection says (set on the visualiser, under Digits → Phones):
  flip, face up to face down (cos β · cos γ, the reaction canvas's horizontal mode); invert, upright to
  upside down (sin β); or spin, as a steering wheel with the screen to you, upright to upside down through landscape (the roll in
  the screen's plane, evenly with the angle, however far it leans back). Set high and set low, beside it,
  calibrate every phone at once: each takes which way it's held now as its +1 or −1 (reset goes back),
  keeping its own for each detection. Valence then runs between the two along whatever turn joins
  them, held any way, rather than as the detection reads it (the detection's own end stands in for
  one not set). The screen
  shows the tilt as the visualiser draws digits, in the room's gradient. Touching anywhere on the screen rings this
  participant's cursor on the visualiser, in their own colour (which the phone also shows around its
  edge). The phone keeps its screen awake while joined.
- **`/viz`, the visualiser.** Everything in v3.3, plus every participant in the room as a cursor
  beside the digits. A participant's tilt is the ink of the pixel being read right now, and of every
  pixel the playhead passed since the last frame. What they've drawn so far is read as a trace, just
  as a digit's pixels are (same smoothing and mapping), so it's grouped and clustered over the window
  the same way. Each participant's drawing also shows in a square along the bottom; tapping one
  switches it to their valence right now (the whole square in the gradient, as their phone shows it)
  and back. One gradient (View → Style) colours valence everywhere it's shown, −1 to +1: the
  visualiser, digit images, matrix, legend and phones. Black/white, white/black, red/black/green
  (the default, as the visualiser was) or red/white/green.
- **Rows only.** Every digit, and every drawing, is read row by row, left to right, as a pen writes:
  v3.3's other reading orders (snake, columns, spiral, Hilbert) are gone. The visualiser keeps a
  metronome, so participants can hear where they are in the digit: a beep every so many pixels (a
  row, 28, by default), the first of each bar higher (4 beats a bar by default; or 3, 2, or 1, which
  accents none). Play tab; on by default, and kept to each screen rather than shared. Touching participants get a pulsing ring in their colour. The most
  recent of them shows in the corner square, bordered in that colour. Following one shows their
  drawing in the inspect tab.
- **Settings are shared** between every visualiser in the room, so a phone with `/viz` open can
  change the big screen's settings. The drawer and its tabs, playback, and wake lock stay local to
  each page.

Rooms: add `?room=name` to both pages to use a separate room. The default room is `main`.

```sh
# 1. Process data (writes v4-1/web/public/data/, including pca.bin to project drawings with)
cd ../pipeline
uv run v4-1.py

# 2. Run locally: the pages and the worker (with its Durable Object) together, in Vite
cd ../v4-1/web
pnpm install
pnpm dev                     # http://localhost:5173/ (remote) and /viz

# 3. Deploy to Cloudflare (after `pnpm wrangler login`, or with a token in .env: see .env.example)
pnpm run deploy
```

Phones only report tilt to secure pages (https), so the remote needs the deployed site (or a tunnel
to the dev server). Over plain http on a LAN, the remote says so.

## How it works

- `worker/index.ts`: the Worker serves the built pages as static assets and hands `/ws` to the room
  (`Room`, one Durable Object per room name). The room uses the WebSocket hibernation API.
  - Each remote gets a slot, kept by the phone's id (in its localStorage) so it keeps its colour
    across reloads. Slots are stored in the object's storage.
  - Tilt and touch are relayed to every visualiser and held only in memory, since remotes resend
    them many times a second.
  - A newer socket for the same participant replaces the older one.
  - Remotes ping every second. An alarm closes any remote not heard from in 15 s, since a phone that
    dies may never close its socket.
- `src/protocol.ts`: the messages, shared by the worker and both pages.
- `src/live.ts`: the visualiser's side of the room, and settings sync. Every visualiser hears every
  settings change in the order the room saw them, its own included. While its own changes are still
  on their way, it ignores everyone else's (they came first, so its own will win). That way all the
  visualisers end up agreeing even when two change something at once.
- Each participant's drawing is kept as a 28×28 image in rows after the digit pool (`liveRow` in
  `src/useData.ts`). That way the corner square, the legend and the inspect tab show it like any
  digit, and the traces are re-read from it every frame (`rereadTraces` in `src/signal.ts`).
- Clustering over the full digit uses principal components. The pipeline now also exports the PCA
  (`pca.bin`: means, then loadings), and participants' drawings are projected onto it as often as
  the window would be clustered.
- Participants can't be the speaker, because their drawing changes as they draw. They don't count
  towards "skip blank pixels" either.
