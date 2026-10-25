# TODO

- [ ] A palette toggle for the whole app: red–green (disagree–agree) or black–white. Valence is
      red–green almost everywhere (chords, cursors, trails, particles, the valence meter), but the
      speaker's agreement square is black–white (agreeing white, ink against paper black, in
      `src/digitImage.ts`). One setting should choose either palette for everything.
- [ ] The matrix should draw valence, not ink. It shades each cell by the digit's own ink in
      greyscale (`traces.ink` in `src/components/Matrix.tsx`), so with a speaker it doesn't show
      agreement at all. Drawing `traces.valence` instead, in the chosen palette (see above), would
      show each digit's agreement with the speaker, and its own ink as now without one.
