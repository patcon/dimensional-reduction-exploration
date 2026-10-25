# TODO

- [ ] A palette toggle for the whole app: red–green (disagree–agree) or black–white. Valence is
      red–green almost everywhere (chords, cursors, trails, particles, the valence meter), but the
      speaker's agreement square is black–white (agreeing white, ink against paper black, in
      `src/digitImage.ts`). One setting should choose either palette for everything.
- [ ] The matrix should draw valence, not ink. It shades each cell by the digit's own ink in
      greyscale (`traces.ink` in `src/components/Matrix.tsx`), so with a speaker it doesn't show
      agreement at all. Drawing `traces.valence` instead, in the chosen palette (see above), would
      show each digit's agreement with the speaker, and its own ink as now without one.
- [ ] Investigate a reading order that follows the stroke path, as a pen would draw the digit,
      rather than a fixed sweep (rows, snake, columns, spiral, Hilbert in `src/signal.ts`). A stroke
      path belongs to one digit, but every digit is read in the same order (traces share
      `pixelAt`/`momentOf`), so whose path? The speaker's is a natural choice: the others would be
      heard along the speaker's own stroke. Paper pixels would still need placing, before, after or
      between stroke segments.
