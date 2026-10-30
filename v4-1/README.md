# v4.1 — MNIST valence music

Built on [v4.0](../v4-0/), with music: a random walk through the digits' nearest neighbours over
the window, as the playhead reads. After "Density clusters on deskewed digits", which walked a fixed
map of 2,000 digits; here the map is the window, so it changes as the playhead moves.

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
  accents none). Play tab; on by default, and kept to each screen rather than shared. In v4.1 it's
  off for now (its controls hidden, its code kept): with no groups, the music keeps time instead. Touching participants get a pulsing ring in their colour. The most
  recent of them shows in the corner square, bordered in that colour. Following one shows their
  drawing in the inspect tab.
- **Grouping by UMAP+HDBSCAN** (Groups tab), beside label and Leiden: UMAP embeds the digits by
  their nearest neighbours (the Groups tab's), then HDBSCAN finds dense regions in it, deciding how
  many groups there are itself; stragglers are left as noise, a grey group of their own. Its minimum
  group size and samples, and whether all can be one group, are its own (the music's broad groups
  have theirs). Over the full digit or the window, as Leiden; it's worked out in a worker, so its
  clusters arrive a moment later (grouped by label until the first), and keep their numbers and
  colours from one run to the next.
- **Music** (the note button, under the digits at the top left, or the music tab). A walker steps
  through the digits (and participants) at random, along their nearest neighbours over the window,
  each step to a neighbour as likely as it's strongly linked, and is ringed in white on the
  visualiser. Tapping a digit moves the walker to it.
  - *Broad groups set the harmony.* The window is embedded by UMAP (10 dimensions), and HDBSCAN finds
    its dense regions, deciding how many there are itself and leaving stragglers as noise. One chord
    tone per group: a single tone for one, an open fifth for two, a triad for three, up to a dense
    cluster at twelve, its timbre fuller and its voices spread wider the more there are. A change in
    how many is announced with an arpeggio. The walker's group's tone is louder, and the bass plays
    it; on noise, the bass drops out and the melody softens.
  - *Small groups set the melody.* Leiden at a high resolution on the same neighbours; each small
    group is given a note of the chord, so the tune changes as the walker crosses from one to the
    next, louder on a new one.
  - *No groups, a metronome.* With no digits or participants, or every one left as noise, there's
    nothing to harmonise, so the walk keeps time with a click instead, at its tempo and swing.
  - The music tab shows what the walker is on, the chord, and what each broad group holds, with
    HDBSCAN's minimum group size and samples, the neighbours and resolution, steps a second and swing,
    and a mix of chord, bass and melody. The groups are worked out again as often as the window is
    clustered (Grouping's rate), whatever the visualiser's own grouping compares over. Music plays
    while paused too (over the window where the playhead stopped), and is on or off for each screen; its settings are shared.
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
- `src/windowMusic.ts`: the window's neighbours and groups for the music, in a worker
  (`src/windowMusic.worker.ts`), as UMAP takes a few hundred milliseconds. UMAP is `umap-js`, given
  the same nearest neighbours; HDBSCAN (`src/hdbscan.ts`) is a port of the inspiration's.
  `src/music.ts` is the walker and the synth (Web Audio), which shares the page's AudioContext with
  the metronome (`src/audio.ts`).
- Participants can't be the speaker, because their drawing changes as they draw. They don't count
  towards "skip blank pixels" either.
