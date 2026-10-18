# TODO

- [ ] Move the pixel shuffle controls onto the digit preview, as rulers along its edges.
      See [docs/shuffle-controls-on-preview.md](docs/shuffle-controls-on-preview.md).
- [ ] Model missingness: as well as pass (mid-grey), let some cells be unseen, as when a participant
      never sees a statement. E.g. hide a random share of pixels per digit, or more at coarser
      resolutions to stand for patchier knowledge, and handle the gaps in clustering and projections
      rather than filling them in. The vote theme could then draw unseen cells white, as in
      valency-anndata's dataset fingerprints.
