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
its group, or its true pattern), with the edges Leiden sees. Each phone's
**trail** recedes into the screen as time goes back, coloured by its facing then, so a pattern's flips
show as stripes along it. Its three views, swept between: the **2d time slice** (front on, flat), the
**2d time series** (side on, time running left to right) and **3d** (in perspective, by a dolly zoom);
drag to turn or pan, pinch or scroll to zoom. Live phones are ringed in their own colour, bigger and
pulsing while touched. Rings round each dot in its group's colour are a View setting, off by default.

## Phones (Phones tab)

The detection (flip, invert or spin) and gradient go to every phone. **Set high** and **set low**
calibrate every phone at once: each takes which way it's held now as its +1 or −1, and then reads how
much nearer it is to its high than its low, over how far apart they are. This is new, here and in v4.0
and v4.1: before, a phone read its place along the turn between the two, and nothing when held off it.
With setpoints near opposite, as face up and face down are, that turn is barely defined, so flipping the
phone any other way read only −1 or +1 and held through the middle. Now it runs smoothly from one end
to the other however it's turned over (`pnpm run check:crowd` checks this).

## Tempo (Sound tab)

The song runs at a tempo in steps a minute (120 is its own: half-second steps, four to a 2 s bar), and
the simulated phones, the metronome and the music all keep to it, as everything runs on the song's clock.
It's set by hand, or, following the phones' beat (on by default), found in the live phones' flips:

- Each flip is noted as its reading arrives from the room (not as frames are drawn), timed by when the
  phone last passed edge on. Over the last 10 s, for each step from 0.25 to 1.6 s, the flips are wound
  round a circle that long, and how tightly they bunch says how well they fit it. The best is the base
  unit: half of it fits less tightly, twice it misses the flips between. Folded into 0.35–0.7 s steps
  (86–171 a minute), so people flipping only every other step (as Slow does) give the same step.
- It takes about 6–10 s of flips, fewer the more people flip; a few flips at random can bunch by
  chance, so few flips have to bunch more tightly to count. The tempo eases towards each new reading,
  and holds when people stop.
- The song's clock also leans up to 12% ahead or back, so people's flips fall where a simulated phone's
  would (0.29 s past a step: its average lag, and half a flip). People following the metronome are
  heard late, as they react; that's what the 0.29 s allows for. If they react much later or sooner
  than that, the lean can't settle, and the tempo can drift: turn following off to hold it.

`pnpm run check:crowd` checks the beat is found at 100, 140 and 165 a minute from people playing a mix
of patterns, from Slow ones alone, and not from flips at random.

## Sound (Sound tab)

The ensemble is the groups of at least the smallest group's size (a slider atop the tab, in phones: 1 to
start, so even a lone phone gets a voice), in the
order they first appeared, up to five. As **chord tones**, each adds a sustained tone, building root →
fifth → third → seventh → ninth (C, C5, C, Cmaj7, Cmaj9), with a chime as it arrives; as **instrument
voices**, each is an instrument (bass, pluck, keys, bell, lead) playing its chord tone over a four-bar
loop (Cmaj9 · Am9 · Fmaj9 · G9) on the steps where its phones were seen flipping. A metronome clicks
each step, accenting the bar: what people flip to. The music has steps of its own, a number to each step:
at half speed (or a slow tempo), 2 keeps each group's rhythm and the chords going round at their
full-speed pace, so people can flip slowly without the music dragging. Auto (the default) picks 1, 2 or
4 from the speed and tempo; or set it by hand. Sound and the metronome are each screen's own; every other setting is
shared between the visualisers in a room, as in v4.

```sh
cd v6-0/web
pnpm install
pnpm dev                     # http://localhost:5173/viz (visualiser) and / (remote)
pnpm run check:crowd         # grouping finds the sections; the beat is heard; calibrated phones read smoothly
pnpm run deploy              # to Cloudflare (after `pnpm wrangler login`, or with a token in .env)
```

Phones only report tilt to secure pages (https), so the remote needs the deployed site (or a tunnel:
`pnpm run dev:share`).
