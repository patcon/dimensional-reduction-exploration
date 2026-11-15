# v6.0 — Phone-flip crowd

A new direction: no digits. A crowd flips their phones to the beat, face up (+1) and face down (−1),
and the visualiser groups them by rhythm, live, on a force-directed graph, each group a tone in the
chord. A port of "Phone-flip crowd · harmony from clusters" (a single HTML page), with the parts
of v4.1 it needed: the Cloudflare Worker and its room, the phone remote (set high and set low
included), the three.js visualiser's look, views and trails, and the drawer of v2.1 on.

It's a Cloudflare Worker (`phone-flip-crowd`) with a Durable Object room, as v4.0 and v4.1 are.

- **`/viz`, the visualiser.** Plays on its own, with a simulated crowd; anyone can join with a phone
  (the QR button, top right).
- **`/`, the phone remote.** v4.1's: flipped, inverted or spun, as the room's detection says, its
  screen in the room's gradient, touch to ring it on the visualiser.

## The crowd

- **Simulated phones** (60 to start, 3–150; Crowd tab), in three sections: **Slow** flips on 1 and &
  (every second), **Fast** on every step (every half second), **1-e-&** on 1, e and &, resting on a.
  One bar is 2 s, four half-second steps counted 1 e & a. **1-&-a** is a fourth, only ever chosen: like
  the others, on a clean grid it correlates at exactly 0 with each. Each phone has its own reaction
  lag, timing jitter, flip speed, tilt, a slight wobble and sensor noise, and may miss flips; facing
  sync sets how many keep to their section's agreed facing rather than starting either way up.
- **Live phones** join the crowd as they join the room, recorded at the same 20 samples a second as
  the song's clock runs (so only while it plays), and grouped with the rest.
- **Move 10%** moves a tenth of the crowd to the next section's pattern at the next bar; **Reset**
  starts the song over, and **Reset shuffled** deals the sections out across the seats at random.

## Painting (Paint tab, open first)

As "Phone-flip crowd" had it: select phones and give them a new pattern, as if pointing at part of the
room and saying "now do this one". Select by dragging over rows of the timeline (by touch, tap a first
row then a last, so the drawer still scrolls; the same row twice for just it), by a detected group's
button, or by tapping phones on the graph while the tab is open (otherwise a tap follows a phone).
Selected phones are ringed in white on the graph, and marked beside their rows. They switch at the next
step after what's been worked out, so nothing already played changes, and a tick in the new pattern's
colour marks where on their rows. The window takes up to 4 bars to catch up: meanwhile they're a mix of
two patterns, and tend to drift off as a group of their own, or sit in "other". Live phones can be
selected but play what their people play.

The timeline shows every phone's facing over the last bars, a row each, by detected group, with its
true pattern (outer) and detected group (inner) on the left and the window being grouped shaded. Rows
hold their order while a selection is being made.

## Grouping (Groups tab)

Every half second, each pair of phones is compared on the last 4 bars (8 s): their correlation, at the
best shift within the lag tolerance, either as it is (requiring +1/−1 alignment: face up and face down
at once are opposites) or as its size (only the rhythm counts, the default). Leiden (CPM or RB
modularity, on every pair or on each phone's k nearest, warm-started from the last window) groups
them, in a worker. Groups keep their colours from one window to the next by overlap; past five, they're
"other". The tab shows how many groups, how well they match the true patterns (ARI, over the simulated
phones) and what each is made of.

## The graph (View tab)

Every pair of phones pulls together as much as it's alike (similarity above a floor, squared, eased
towards each new window and normalised by degree), against a softened push between all of them. Drawn
as v4's visualiser draws its chords: dark, inside a ring, each phone a dot coloured by its facing now (or
its group, or its true pattern), ringed in its group's colour, with the edges Leiden sees. Each phone's
**trail** recedes into the screen as time goes back, coloured by its facing then, so a pattern's flips
show as stripes along it. Its three views, swept between: the **2d time slice** (front on, flat), the
**2d time series** (side on, time running left to right) and **3d** (in perspective, by a dolly zoom);
drag to turn or pan, pinch or scroll to zoom. Live phones are ringed in their own colour, bigger and
pulsing while touched. The circle round the graph (and its copies receding in 3d) is off by default.

## Phones (Phones tab)

The detection (flip, invert or spin) and gradient go to every phone. **Set high** and **set low**
calibrate every phone at once: each takes which way it's held now as its +1 or −1, and then reads how
much nearer it is to its high than its low, over how far apart they are. This is new, here and in v4.0
and v4.1: before, a phone read its place along the turn between the two, and nothing when held off it.
With setpoints near opposite, as face up and face down are, that turn is barely defined, so flipping the
phone any other way read only −1 or +1 and held through the middle. Now it runs smoothly from one end
to the other however it's turned over (`pnpm run check:crowd` checks this).

## Sound (Sound tab)

The ensemble is the groups at least as big as the smallest group setting (10% of the phones), in the
order they first appeared, up to five. As **chord tones**, each adds a sustained tone, building root →
fifth → third → seventh → ninth (C, C5, C, Cmaj7, Cmaj9), with a chime as it arrives; as **instrument
voices**, each is an instrument (bass, pluck, keys, bell, lead) playing its chord tone over a four-bar
loop (Cmaj9 · Am9 · Fmaj9 · G9) on the steps where its phones were seen flipping. A metronome clicks
each step, accenting the bar. Sound and the metronome are each screen's own; every other setting is
shared between the visualisers in a room, as in v4.

```sh
cd v6-0/web
pnpm install
pnpm dev                     # http://localhost:5173/viz (visualiser) and / (remote)
pnpm run check:crowd         # grouping finds the sections again; calibrated phones read smoothly
pnpm run deploy              # to Cloudflare (after `pnpm wrangler login`, or with a token in .env)
```

Phones only report tilt to secure pages (https), so the remote needs the deployed site (or a tunnel:
`pnpm run dev:share`).
